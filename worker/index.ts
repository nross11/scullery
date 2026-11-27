import { Hono } from 'hono';
import type { AppEnv } from './types';
import { authRoutes, createApiToken, requireUser } from './auth';
import { createRecipe, importUrl, recipeRoutes } from './recipes';
import { cookLogRoutes, planRoutes, shoppingRoutes } from './planning';
import { id } from './util';

const app = new Hono<AppEnv>().basePath('/api');

app.route('/auth', authRoutes);

app.use('/*', async (c, next) => {
  if (c.req.path.startsWith('/api/auth/')) return next();
  return requireUser(c, next);
});

app.get('/me', async (c) => {
  const user = c.get('user');
  const { results: members } = await c.env.DB.prepare('SELECT name, email, avatar_url FROM users WHERE household_id = ?').bind(user.household_id).all();
  return c.json({ ...user, members });
});

// Personal tokens for the iOS Shortcut.
app.get('/tokens', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT id, label, created_at FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC').bind(c.get('user').id).all();
  return c.json(results.map((r: any) => ({ ...r, id: String(r.id).slice(0, 8) })));
});
app.post('/tokens', async (c) => {
  const { label } = await c.req.json<{ label?: string }>();
  const token = await createApiToken(c.env, c.get('user').id, label || 'iPhone Shortcut');
  return c.json({ token });
});
app.delete('/tokens/:prefix', async (c) => {
  await c.env.DB.prepare("DELETE FROM api_tokens WHERE user_id = ? AND id LIKE ? || '%'").bind(c.get('user').id, c.req.param('prefix')).run();
  return c.json({ ok: true });
});

/**
 * Called by the iOS Shortcut from the share sheet. Imports the URL (and any shared text),
 * saves it as a new recipe, and returns a link to open it.
 */
app.post('/share', async (c) => {
  const ct = c.req.header('content-type') || '';
  let url: string | null = null;
  let text: string | null = null;
  if (ct.includes('application/json')) {
    const b = await c.req.json<{ url?: string; text?: string }>();
    url = b.url ?? null;
    text = b.text ?? null;
  } else {
    const f = await c.req.parseBody();
    url = (f.url as string) || null;
    text = (f.text as string) || null;
  }
  // The share sheet often hands over text with a URL inside it.
  if (!url && text) {
    const m = text.match(/https?:\/\/\S+/);
    if (m) {
      url = m[0];
      text = text.replace(m[0], '').trim() || null;
    }
  }
  if (!url && !text) return c.json({ error: 'nothing shared' }, 400);
  const result = await importUrl(url, text);
  const rid = await createRecipe(c.env, c.get('user'), { ...result.draft, tags: result.draft.tags ?? [] } as any);
  const link = new URL(`/recipes/${rid}${result.structured ? '' : '?tidy=1'}`, c.req.url).toString();
  return c.json({ id: rid, url: link, structured: result.structured, title: result.draft.title });
});

// Photos stored in R2, served back through the Worker.
app.post('/photos', async (c) => {
  const type = c.req.header('content-type') || 'image/jpeg';
  if (!type.startsWith('image/')) return c.json({ error: 'not an image' }, 400);
  const buf = await c.req.arrayBuffer();
  if (buf.byteLength > 10 * 1024 * 1024) return c.json({ error: 'too large' }, 413);
  const key = `${c.get('user').household_id}/${id()}`;
  await c.env.PHOTOS.put(key, buf, { httpMetadata: { contentType: type } });
  return c.json({ url: `/api/photos/${key}` });
});
app.get('/photos/:hh/:key', async (c) => {
  if (c.req.param('hh') !== c.get('user').household_id) return c.json({ error: 'not found' }, 404);
  const obj = await c.env.PHOTOS.get(`${c.req.param('hh')}/${c.req.param('key')}`);
  if (!obj) return c.json({ error: 'not found' }, 404);
  return new Response(obj.body, {
    headers: { 'content-type': obj.httpMetadata?.contentType || 'image/jpeg', 'cache-control': 'private, max-age=31536000, immutable' },
  });
});

app.route('/recipes', recipeRoutes);
app.route('/cook-logs', cookLogRoutes);
app.route('/plan', planRoutes);
app.route('/shopping', shoppingRoutes);

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'server error' }, 500);
});

export default app;
