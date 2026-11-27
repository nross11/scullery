import { Hono } from 'hono';
import type { AppEnv } from './types';
import { id, now } from './util';
import { buildShoppingList, guessAisle, AISLE_ORDER, type PlannedIngredient } from '../shared/shopping';
import type { RecipeBody } from '../shared/recipe';

// ---------- Cook log ----------
export const cookLogRoutes = new Hono<AppEnv>();

interface LogInput { cookedOn?: string; rating?: number | null; howItWent?: string | null; nextTime?: string | null }

cookLogRoutes.post('/', async (c) => {
  const user = c.get('user');
  const input = await c.req.json<LogInput & { recipeId: string }>();
  const r = await c.env.DB.prepare('SELECT current_version_id FROM recipes WHERE id = ? AND household_id = ?')
    .bind(input.recipeId, user.household_id).first<{ current_version_id: string }>();
  if (!r) return c.json({ error: 'not found' }, 404);
  const lid = id();
  await c.env.DB.prepare(
    `INSERT INTO cook_logs (id, recipe_id, recipe_version_id, household_id, cooked_on, rating, how_it_went, next_time, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(lid, input.recipeId, r.current_version_id, user.household_id, input.cookedOn || now().slice(0, 10),
    input.rating ?? null, input.howItWent ?? null, input.nextTime ?? null, user.id).run();
  return c.json({ id: lid });
});

async function loadLog(c: any, logId: string) {
  return c.env.DB.prepare('SELECT * FROM cook_logs WHERE id = ? AND household_id = ?')
    .bind(logId, c.get('user').household_id).first();
}

/** Every edit snapshots the previous state first, so cook-log history is never lost. */
cookLogRoutes.put('/:id', async (c) => {
  const user = c.get('user');
  const log = await loadLog(c, c.req.param('id'));
  if (!log) return c.json({ error: 'not found' }, 404);
  const input = await c.req.json<LogInput>();
  const snapshot = { cooked_on: log.cooked_on, rating: log.rating, how_it_went: log.how_it_went, next_time: log.next_time, deleted: log.deleted };
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO cook_log_revisions (id, cook_log_id, snapshot, edited_by) VALUES (?, ?, ?, ?)')
      .bind(id(), log.id, JSON.stringify(snapshot), user.id),
    c.env.DB.prepare('UPDATE cook_logs SET cooked_on = ?, rating = ?, how_it_went = ?, next_time = ?, updated_at = ? WHERE id = ?')
      .bind(input.cookedOn ?? log.cooked_on, input.rating === undefined ? log.rating : input.rating,
        input.howItWent === undefined ? log.how_it_went : input.howItWent,
        input.nextTime === undefined ? log.next_time : input.nextTime, now(), log.id),
  ]);
  return c.json({ ok: true });
});

cookLogRoutes.delete('/:id', async (c) => {
  const user = c.get('user');
  const log = await loadLog(c, c.req.param('id'));
  if (!log) return c.json({ error: 'not found' }, 404);
  const snapshot = { cooked_on: log.cooked_on, rating: log.rating, how_it_went: log.how_it_went, next_time: log.next_time, deleted: log.deleted };
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO cook_log_revisions (id, cook_log_id, snapshot, edited_by) VALUES (?, ?, ?, ?)')
      .bind(id(), log.id, JSON.stringify(snapshot), user.id),
    c.env.DB.prepare('UPDATE cook_logs SET deleted = 1, updated_at = ? WHERE id = ?').bind(now(), log.id),
  ]);
  return c.json({ ok: true });
});

cookLogRoutes.get('/:id/revisions', async (c) => {
  const log = await loadLog(c, c.req.param('id'));
  if (!log) return c.json({ error: 'not found' }, 404);
  const { results } = await c.env.DB.prepare(
    `SELECT r.id, r.snapshot, r.edited_at, u.name AS editor_name FROM cook_log_revisions r
     LEFT JOIN users u ON u.id = r.edited_by WHERE r.cook_log_id = ? ORDER BY r.edited_at DESC`,
  ).bind(log.id).all<{ snapshot: string }>();
  return c.json({ current: log, revisions: results.map((r) => ({ ...r, snapshot: JSON.parse(r.snapshot) })) });
});

cookLogRoutes.post('/:id/revisions/:rid/restore', async (c) => {
  const user = c.get('user');
  const log = await loadLog(c, c.req.param('id'));
  if (!log) return c.json({ error: 'not found' }, 404);
  const rev = await c.env.DB.prepare('SELECT snapshot FROM cook_log_revisions WHERE id = ? AND cook_log_id = ?')
    .bind(c.req.param('rid'), log.id).first<{ snapshot: string }>();
  if (!rev) return c.json({ error: 'not found' }, 404);
  const s = JSON.parse(rev.snapshot);
  const snapshot = { cooked_on: log.cooked_on, rating: log.rating, how_it_went: log.how_it_went, next_time: log.next_time, deleted: log.deleted };
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO cook_log_revisions (id, cook_log_id, snapshot, edited_by) VALUES (?, ?, ?, ?)')
      .bind(id(), log.id, JSON.stringify(snapshot), user.id),
    c.env.DB.prepare('UPDATE cook_logs SET cooked_on = ?, rating = ?, how_it_went = ?, next_time = ?, deleted = ?, updated_at = ? WHERE id = ?')
      .bind(s.cooked_on, s.rating, s.how_it_went, s.next_time, s.deleted ?? 0, now(), log.id),
  ]);
  return c.json({ ok: true });
});

// ---------- Meal plan ----------
export const planRoutes = new Hono<AppEnv>();

planRoutes.get('/', async (c) => {
  const { from, to } = c.req.query();
  const { results } = await c.env.DB.prepare(
    `SELECT p.*, v.title AS recipe_title, r.image_key, json_extract(v.body, '$.servings') AS base_servings
     FROM meal_plan p LEFT JOIN recipes r ON r.id = p.recipe_id LEFT JOIN recipe_versions v ON v.id = r.current_version_id
     WHERE p.household_id = ? AND p.plan_date BETWEEN ? AND ? ORDER BY p.plan_date, p.sort`,
  ).bind(c.get('user').household_id, from, to).all();
  return c.json(results);
});

planRoutes.post('/', async (c) => {
  const user = c.get('user');
  const input = await c.req.json<{ planDate: string; meal?: string; recipeId?: string | null; note?: string | null; servings?: number | null }>();
  if (input.recipeId) {
    const ok = await c.env.DB.prepare('SELECT 1 FROM recipes WHERE id = ? AND household_id = ?').bind(input.recipeId, user.household_id).first();
    if (!ok) return c.json({ error: 'not found' }, 404);
  }
  const pid = id();
  await c.env.DB.prepare('INSERT INTO meal_plan (id, household_id, plan_date, meal, recipe_id, note, servings, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(pid, user.household_id, input.planDate, input.meal ?? 'dinner', input.recipeId ?? null, input.note ?? null, input.servings ?? null, Date.now() % 1e9).run();
  return c.json({ id: pid });
});

planRoutes.put('/:id', async (c) => {
  const input = await c.req.json<{ planDate?: string; meal?: string; servings?: number | null; note?: string | null }>();
  const cur = await c.env.DB.prepare('SELECT * FROM meal_plan WHERE id = ? AND household_id = ?').bind(c.req.param('id'), c.get('user').household_id).first<any>();
  if (!cur) return c.json({ error: 'not found' }, 404);
  await c.env.DB.prepare('UPDATE meal_plan SET plan_date = ?, meal = ?, servings = ?, note = ? WHERE id = ?')
    .bind(input.planDate ?? cur.plan_date, input.meal ?? cur.meal, input.servings === undefined ? cur.servings : input.servings,
      input.note === undefined ? cur.note : input.note, cur.id).run();
  return c.json({ ok: true });
});

planRoutes.delete('/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM meal_plan WHERE id = ? AND household_id = ?').bind(c.req.param('id'), c.get('user').household_id).run();
  return c.json({ ok: true });
});

// ---------- Shopping lists ----------
export const shoppingRoutes = new Hono<AppEnv>();

shoppingRoutes.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT l.*, (SELECT count(*) FROM shopping_items WHERE list_id = l.id) AS total,
       (SELECT count(*) FROM shopping_items WHERE list_id = l.id AND checked = 1) AS done
     FROM shopping_lists l WHERE l.household_id = ? ORDER BY l.created_at DESC LIMIT 50`,
  ).bind(c.get('user').household_id).all();
  return c.json(results);
});

/** Generate a list from planned meals between two dates. */
shoppingRoutes.post('/generate', async (c) => {
  const user = c.get('user');
  const { from, to, name } = await c.req.json<{ from: string; to: string; name?: string }>();
  const { results } = await c.env.DB.prepare(
    `SELECT p.servings, v.title, v.body FROM meal_plan p JOIN recipes r ON r.id = p.recipe_id
     JOIN recipe_versions v ON v.id = r.current_version_id
     WHERE p.household_id = ? AND p.plan_date BETWEEN ? AND ?`,
  ).bind(user.household_id, from, to).all<{ servings: number | null; title: string; body: string }>();
  const planned: PlannedIngredient[] = [];
  for (const row of results) {
    const body = JSON.parse(row.body) as RecipeBody;
    const factor = row.servings && body.servings ? row.servings / body.servings : 1;
    for (const g of body.ingredients) for (const ing of g.items) planned.push({ ingredient: ing, factor, recipeTitle: row.title });
  }
  const lines = buildShoppingList(planned);
  const lid = id();
  const stmts = [
    c.env.DB.prepare('INSERT INTO shopping_lists (id, household_id, name, from_date, to_date) VALUES (?, ?, ?, ?, ?)')
      .bind(lid, user.household_id, name || `Shopping ${from} to ${to}`, from, to),
    ...lines.map((l, i) =>
      c.env.DB.prepare('INSERT INTO shopping_items (id, list_id, name, quantity, unit, aisle, sources, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(id(), lid, l.name, l.quantity, l.unit, l.aisle, JSON.stringify(l.sources), i)),
  ];
  await c.env.DB.batch(stmts);
  return c.json({ id: lid });
});

async function ownList(c: any, listId: string) {
  return c.env.DB.prepare('SELECT * FROM shopping_lists WHERE id = ? AND household_id = ?').bind(listId, c.get('user').household_id).first();
}

shoppingRoutes.get('/:id', async (c) => {
  const list = await ownList(c, c.req.param('id'));
  if (!list) return c.json({ error: 'not found' }, 404);
  const { results } = await c.env.DB.prepare('SELECT * FROM shopping_items WHERE list_id = ? ORDER BY sort').bind(list.id).all<any>();
  const items = results.map((r) => ({ ...r, sources: r.sources ? JSON.parse(r.sources) : [] }));
  items.sort((a, b) => AISLE_ORDER.indexOf(a.aisle) - AISLE_ORDER.indexOf(b.aisle) || a.sort - b.sort);
  return c.json({ ...list, items, aisles: AISLE_ORDER });
});

shoppingRoutes.post('/:id/items', async (c) => {
  const list = await ownList(c, c.req.param('id'));
  if (!list) return c.json({ error: 'not found' }, 404);
  const { name, aisle } = await c.req.json<{ name: string; aisle?: string }>();
  const iid = id();
  await c.env.DB.prepare('INSERT INTO shopping_items (id, list_id, name, aisle, sort) VALUES (?, ?, ?, ?, ?)')
    .bind(iid, list.id, name, aisle || guessAisle(name), 100000).run();
  return c.json({ id: iid });
});

shoppingRoutes.put('/:id/items/:itemId', async (c) => {
  const list = await ownList(c, c.req.param('id'));
  if (!list) return c.json({ error: 'not found' }, 404);
  const input = await c.req.json<{ checked?: boolean; name?: string; quantity?: number | null; unit?: string | null; aisle?: string }>();
  const cur = await c.env.DB.prepare('SELECT * FROM shopping_items WHERE id = ? AND list_id = ?').bind(c.req.param('itemId'), list.id).first<any>();
  if (!cur) return c.json({ error: 'not found' }, 404);
  await c.env.DB.prepare('UPDATE shopping_items SET checked = ?, name = ?, quantity = ?, unit = ?, aisle = ? WHERE id = ?')
    .bind(input.checked === undefined ? cur.checked : input.checked ? 1 : 0, input.name ?? cur.name,
      input.quantity === undefined ? cur.quantity : input.quantity, input.unit === undefined ? cur.unit : input.unit,
      input.aisle ?? cur.aisle, cur.id).run();
  return c.json({ ok: true });
});

shoppingRoutes.delete('/:id/items/:itemId', async (c) => {
  const list = await ownList(c, c.req.param('id'));
  if (!list) return c.json({ error: 'not found' }, 404);
  await c.env.DB.prepare('DELETE FROM shopping_items WHERE id = ? AND list_id = ?').bind(c.req.param('itemId'), list.id).run();
  return c.json({ ok: true });
});

shoppingRoutes.delete('/:id', async (c) => {
  const list = await ownList(c, c.req.param('id'));
  if (!list) return c.json({ error: 'not found' }, 404);
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM shopping_items WHERE list_id = ?').bind(list.id),
    c.env.DB.prepare('DELETE FROM shopping_lists WHERE id = ?').bind(list.id),
  ]);
  return c.json({ ok: true });
});
