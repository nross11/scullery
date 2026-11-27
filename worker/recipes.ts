import { Hono } from 'hono';
import type { AppEnv, Env } from './types';
import { id, normTag, now } from './util';
import { importFromHtml } from '../shared/importer';
import { htmlToText, youtubeDescription } from '../shared/aiRecipe';
import { AiError, aiChat, aiEnabled, aiHealthier, aiImport, type ChatTurn, type ImageInput } from './ai';
import { emptyBody, sourceKindOf, type RecipeBody, type RecipeDraft } from '../shared/recipe';

export const recipeRoutes = new Hono<AppEnv>();

interface RecipeRow {
  id: string; household_id: string; current_version_id: string; source_url: string | null; source_kind: string;
  image_key: string | null; created_at: string; updated_at: string; title: string; body: string; version_no: number;
}

async function loadRecipe(env: Env, householdId: string, recipeId: string) {
  return env.DB.prepare(
    `SELECT r.*, v.title, v.body, v.version_no FROM recipes r JOIN recipe_versions v ON v.id = r.current_version_id
     WHERE r.id = ? AND r.household_id = ? AND r.archived = 0`,
  ).bind(recipeId, householdId).first<RecipeRow>();
}

function setTagsStatements(env: Env, householdId: string, recipeId: string, tags: string[]) {
  const clean = [...new Set(tags.map(normTag).filter(Boolean))];
  return [
    env.DB.prepare('DELETE FROM tags WHERE recipe_id = ?').bind(recipeId),
    ...clean.map((t) => env.DB.prepare('INSERT INTO tags (household_id, recipe_id, tag) VALUES (?, ?, ?)').bind(householdId, recipeId, t)),
  ];
}

export async function createRecipe(env: Env, user: { id: string; household_id: string }, draft: RecipeDraft): Promise<string> {
  const rid = id();
  const vid = id();
  const body: RecipeBody = { ...emptyBody(), ...draft.body };
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO recipes (id, household_id, current_version_id, source_url, source_kind, image_key, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).bind(rid, user.household_id, vid, draft.sourceUrl, draft.sourceKind ?? sourceKindOf(draft.sourceUrl), draft.imageUrl, user.id),
    env.DB.prepare(
      'INSERT INTO recipe_versions (id, recipe_id, version_no, title, body, change_note, created_by) VALUES (?, ?, 1, ?, ?, ?, ?)',
    ).bind(vid, rid, draft.title.trim() || 'Untitled recipe', JSON.stringify(body), 'Created', user.id),
    ...setTagsStatements(env, user.household_id, rid, draft.tags ?? []),
  ]);
  return rid;
}

recipeRoutes.get('/', async (c) => {
  const user = c.get('user');
  const q = c.req.query('q')?.trim();
  const tag = c.req.query('tag')?.trim();
  let sql = `SELECT r.id, v.title, r.image_key, r.source_kind, r.updated_at,
      (SELECT group_concat(tag, '|') FROM tags WHERE recipe_id = r.id) AS tags,
      (SELECT max(cooked_on) FROM cook_logs WHERE recipe_id = r.id AND deleted = 0) AS last_cooked,
      (SELECT round(avg(rating), 1) FROM cook_logs WHERE recipe_id = r.id AND deleted = 0 AND rating IS NOT NULL) AS avg_rating,
      (SELECT count(*) FROM cook_logs WHERE recipe_id = r.id AND deleted = 0) AS times_cooked
    FROM recipes r JOIN recipe_versions v ON v.id = r.current_version_id
    WHERE r.household_id = ? AND r.archived = 0`;
  const binds: unknown[] = [user.household_id];
  if (q) {
    sql += ' AND (v.title LIKE ? OR v.body LIKE ?)';
    binds.push(`%${q}%`, `%${q}%`);
  }
  if (tag) {
    sql += ' AND EXISTS (SELECT 1 FROM tags t WHERE t.recipe_id = r.id AND t.tag = ?)';
    binds.push(normTag(tag));
  }
  sql += ' ORDER BY r.updated_at DESC LIMIT 500';
  const { results } = await c.env.DB.prepare(sql).bind(...binds).all<Record<string, any>>();
  return c.json(results.map((r) => ({ ...r, tags: r.tags ? String(r.tags).split('|') : [] })));
});

recipeRoutes.get('/tags', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT t.tag, count(*) AS n FROM tags t JOIN recipes r ON r.id = t.recipe_id
     WHERE t.household_id = ? AND r.archived = 0 GROUP BY t.tag ORDER BY n DESC, t.tag`,
  ).bind(c.get('user').household_id).all();
  return c.json(results);
});

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

function cleanImages(raw: unknown): ImageInput[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((i): i is ImageInput => !!i && IMAGE_TYPES.has(i.mediaType) && typeof i.data === 'string' && i.data.length < 7_000_000)
    .slice(0, 6);
}

recipeRoutes.post('/import', async (c) => {
  const { url, text, images } = await c.req.json<{ url?: string; text?: string; images?: unknown }>();
  return c.json(await importUrl(c.env, url, text, cleanImages(images)));
});

export interface ImportOutcome {
  structured: boolean;
  fetched: boolean;
  draft: RecipeDraft;
  /** true when Claude wrote the draft */
  ai?: boolean;
  /** what Claude had to estimate */
  guessed?: string[];
  /** why Claude couldn't help, when it was asked and failed */
  aiNote?: string;
}

export async function importUrl(env: Env, url?: string | null, text?: string | null, images: ImageInput[] = []): Promise<ImportOutcome> {
  url = url?.trim() || null;
  text = text?.trim() || null;
  if (!url) {
    const body = emptyBody();
    body.rawText = text;
    const manual: ImportOutcome = { structured: false, fetched: false, draft: { title: 'Untitled recipe', body, sourceUrl: null, sourceKind: 'manual', imageUrl: null, tags: [] } };
    return text || images.length ? withAi(env, manual, { url: null, sourceKind: 'manual', pastedText: text, images }) : manual;
  }
  let html = '';
  let fetched = false;
  try {
    const res = await fetch(url, {
      headers: {
        'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
        accept: 'text/html,application/xhtml+xml',
        'accept-language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
      cf: { cacheTtl: 300 },
    } as RequestInit);
    if (res.ok) {
      html = (await res.text()).slice(0, 3_000_000);
      fetched = true;
    }
  } catch {
    /* site unreachable: fall through to a manual draft */
  }
  const result: ImportOutcome = { ...importFromHtml(html, url, text), fetched };
  // A proper schema.org recipe is free and exact, so only call Claude when there isn't one.
  if (result.structured) return result;
  const kind = result.draft.sourceKind;
  let pageText: string | null = null;
  if (html) {
    if (kind === 'youtube') {
      const yt = youtubeDescription(html);
      pageText = [yt.title && `Video title: ${yt.title}`, yt.channel && `Channel: ${yt.channel}`, yt.description && `Description:\n${yt.description}`].filter(Boolean).join('\n') || null;
    } else if (kind === 'web') {
      pageText = htmlToText(html) || null;
    } else {
      // Instagram/TikTok rarely give us more than the caption preview in their meta tags.
      pageText = [result.draft.title, result.draft.body.rawText].filter(Boolean).join('\n') || null;
    }
  }
  if (!pageText && !text && !images.length) return result;
  return withAi(env, result, { url, sourceKind: kind, pageText, pastedText: text, images });
}

async function withAi(env: Env, fallback: ImportOutcome, input: Parameters<typeof aiImport>[1]): Promise<ImportOutcome> {
  if (!aiEnabled(env)) return fallback;
  try {
    const out = await aiImport(env, input);
    if ('problem' in out) return { ...fallback, aiNote: out.problem };
    return {
      structured: false,
      fetched: fallback.fetched,
      ai: true,
      guessed: out.guessed,
      draft: { ...out.draft, imageUrl: fallback.draft.imageUrl, body: { ...out.draft.body, rawText: fallback.draft.body.rawText ?? null } },
    };
  } catch (e) {
    if (e instanceof AiError) return { ...fallback, aiNote: e.message };
    throw e;
  }
}

recipeRoutes.post('/', async (c) => {
  const draft = await c.req.json<RecipeDraft>();
  const rid = await createRecipe(c.env, c.get('user'), draft);
  return c.json({ id: rid });
});

recipeRoutes.get('/:id', async (c) => {
  const user = c.get('user');
  const r = await loadRecipe(c.env, user.household_id, c.req.param('id'));
  if (!r) return c.json({ error: 'not found' }, 404);
  const [tags, logs] = await Promise.all([
    c.env.DB.prepare('SELECT tag FROM tags WHERE recipe_id = ? ORDER BY tag').bind(r.id).all<{ tag: string }>(),
    c.env.DB.prepare(
      `SELECT l.*, u.name AS author_name, v.version_no,
        (SELECT count(*) FROM cook_log_revisions WHERE cook_log_id = l.id) AS revisions
       FROM cook_logs l LEFT JOIN users u ON u.id = l.created_by LEFT JOIN recipe_versions v ON v.id = l.recipe_version_id
       WHERE l.recipe_id = ? AND l.deleted = 0 ORDER BY l.cooked_on DESC, l.created_at DESC`,
    ).bind(r.id).all(),
  ]);
  return c.json({
    id: r.id,
    title: r.title,
    body: JSON.parse(r.body),
    versionNo: r.version_no,
    sourceUrl: r.source_url,
    sourceKind: r.source_kind,
    imageUrl: r.image_key,
    tags: tags.results.map((t) => t.tag),
    cookLogs: logs.results,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  });
});

/**
 * Save edits. Title/body changes create a new immutable version; tags, image and source
 * are recipe-level metadata and are updated in place.
 */
recipeRoutes.put('/:id', async (c) => {
  const user = c.get('user');
  const r = await loadRecipe(c.env, user.household_id, c.req.param('id'));
  if (!r) return c.json({ error: 'not found' }, 404);
  const input = await c.req.json<{
    title?: string; body?: RecipeBody; changeNote?: string; fromCookLogId?: string;
    tags?: string[]; imageUrl?: string | null; sourceUrl?: string | null;
  }>();
  const stmts: D1PreparedStatement[] = [];
  const title = input.title?.trim() || r.title;
  const bodyJson = input.body ? JSON.stringify(input.body) : r.body;
  let versionNo = r.version_no;
  if (title !== r.title || bodyJson !== r.body) {
    const vid = id();
    versionNo = r.version_no + 1;
    stmts.push(
      c.env.DB.prepare(
        'INSERT INTO recipe_versions (id, recipe_id, version_no, title, body, change_note, from_cook_log_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).bind(vid, r.id, versionNo, title, bodyJson, input.changeNote?.trim() || (title !== r.title && bodyJson === r.body ? 'Renamed' : 'Edited'), input.fromCookLogId ?? null, user.id),
      c.env.DB.prepare('UPDATE recipes SET current_version_id = ? WHERE id = ?').bind(vid, r.id),
    );
  }
  if (input.imageUrl !== undefined) stmts.push(c.env.DB.prepare('UPDATE recipes SET image_key = ? WHERE id = ?').bind(input.imageUrl, r.id));
  if (input.sourceUrl !== undefined) {
    stmts.push(c.env.DB.prepare('UPDATE recipes SET source_url = ?, source_kind = ? WHERE id = ?').bind(input.sourceUrl, sourceKindOf(input.sourceUrl), r.id));
  }
  if (input.tags) stmts.push(...setTagsStatements(c.env, user.household_id, r.id, input.tags));
  stmts.push(c.env.DB.prepare('UPDATE recipes SET updated_at = ? WHERE id = ?').bind(now(), r.id));
  await c.env.DB.batch(stmts);
  return c.json({ ok: true, versionNo });
});

recipeRoutes.delete('/:id', async (c) => {
  const user = c.get('user');
  await c.env.DB.prepare('UPDATE recipes SET archived = 1 WHERE id = ? AND household_id = ?').bind(c.req.param('id'), user.household_id).run();
  return c.json({ ok: true });
});

recipeRoutes.get('/:id/versions', async (c) => {
  const user = c.get('user');
  const r = await loadRecipe(c.env, user.household_id, c.req.param('id'));
  if (!r) return c.json({ error: 'not found' }, 404);
  const { results } = await c.env.DB.prepare(
    `SELECT v.id, v.version_no, v.title, v.change_note, v.from_cook_log_id, v.created_at, u.name AS author_name
     FROM recipe_versions v LEFT JOIN users u ON u.id = v.created_by WHERE v.recipe_id = ? ORDER BY v.version_no DESC`,
  ).bind(r.id).all();
  return c.json({ current: r.version_no, versions: results });
});

recipeRoutes.get('/:id/versions/:vid', async (c) => {
  const user = c.get('user');
  const v = await c.env.DB.prepare(
    `SELECT v.* FROM recipe_versions v JOIN recipes r ON r.id = v.recipe_id WHERE v.id = ? AND r.id = ? AND r.household_id = ?`,
  ).bind(c.req.param('vid'), c.req.param('id'), user.household_id).first<Record<string, any>>();
  if (!v) return c.json({ error: 'not found' }, 404);
  return c.json({ ...v, body: JSON.parse(v.body) });
});

/** Restoring never deletes history: it copies the old version forward as a new one. */
recipeRoutes.post('/:id/versions/:vid/restore', async (c) => {
  const user = c.get('user');
  const r = await loadRecipe(c.env, user.household_id, c.req.param('id'));
  if (!r) return c.json({ error: 'not found' }, 404);
  const old = await c.env.DB.prepare('SELECT * FROM recipe_versions WHERE id = ? AND recipe_id = ?')
    .bind(c.req.param('vid'), r.id).first<{ title: string; body: string; version_no: number }>();
  if (!old) return c.json({ error: 'not found' }, 404);
  const vid = id();
  await c.env.DB.batch([
    c.env.DB.prepare(
      'INSERT INTO recipe_versions (id, recipe_id, version_no, title, body, change_note, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).bind(vid, r.id, r.version_no + 1, old.title, old.body, `Restored version ${old.version_no}`, user.id),
    c.env.DB.prepare('UPDATE recipes SET current_version_id = ?, updated_at = ? WHERE id = ?').bind(vid, now(), r.id),
  ]);
  return c.json({ ok: true, versionNo: r.version_no + 1 });
});

/** Ask Claude for a healthier version. Nothing is saved: the app shows it and saves it as a new version if accepted. */
recipeRoutes.post('/:id/ai/healthier', async (c) => {
  const user = c.get('user');
  const r = await loadRecipe(c.env, user.household_id, c.req.param('id'));
  if (!r) return c.json({ error: 'not found' }, 404);
  const { goal } = await c.req.json<{ goal?: string }>().catch(() => ({ goal: undefined }));
  try {
    return c.json({ basedOnVersion: r.version_no, ...(await aiHealthier(c.env, r.title, JSON.parse(r.body), goal)) });
  } catch (e) {
    if (e instanceof AiError) return c.json({ error: e.message }, e.status as 400);
    throw e;
  }
});

recipeRoutes.post('/:id/ai/chat', async (c) => {
  const user = c.get('user');
  const r = await loadRecipe(c.env, user.household_id, c.req.param('id'));
  if (!r) return c.json({ error: 'not found' }, 404);
  const { messages } = await c.req.json<{ messages?: ChatTurn[] }>();
  try {
    return c.json({ reply: await aiChat(c.env, r.title, JSON.parse(r.body), Array.isArray(messages) ? messages : []) });
  } catch (e) {
    if (e instanceof AiError) return c.json({ error: e.message }, e.status as 400);
    throw e;
  }
});
