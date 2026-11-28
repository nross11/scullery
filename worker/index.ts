import { Hono } from 'hono';
import type { AppEnv } from './types';
import { authRoutes, createApiToken, requireUser } from './auth';
import { createRecipe, importUrl, recipeRoutes } from './recipes';
import { cookLogRoutes, planRoutes, shoppingRoutes } from './planning';
import { id } from './util';
import { aiEnabled, type ImageInput } from './ai';

const app = new Hono<AppEnv>().basePath('/api');

app.route('/auth', authRoutes);

app.use('/*', async (c, next) => {
  if (c.req.path.startsWith('/api/auth/')) return next();
  return requireUser(c, next);
});

app.get('/me', async (c) => {
  const user = c.get('user');
  const { results: members } = await c.env.DB.prepare('SELECT name, email, avatar_url FROM users WHERE household_id = ?').bind(user.household_id).all();
  return c.json({ ...user, members, ai: aiEnabled(c.env) });
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
  const texts: string[] = [];
  const images: ImageInput[] = [];
  if (ct.includes('application/json')) {
    const b = await c.req.json<{ url?: string; text?: string; input?: string }>();
    url = b.url ?? null;
    for (const t of [b.text, b.input]) if (typeof t === 'string' && t.trim()) texts.push(t);
  } else {
    // The Shortcut sends a form. Fields can be text, or files when a screenshot is shared.
    const f = await c.req.parseBody({ all: true });
    for (const [key, raw] of Object.entries(f)) {
      for (const v of Array.isArray(raw) ? raw : [raw]) {
        if (typeof v === 'string') {
          if (key === 'url' && v.trim()) url = v.trim();
          else if (v.trim()) texts.push(v);
        } else if (v && typeof v === 'object' && 'arrayBuffer' in v) {
          const img = await fileToImage(v as File);
          if ('error' in img) return c.json({ error: img.error, message: img.error }, 400);
          if (images.length < 6) images.push(img);
        }
      }
    }
  }
  let text: string | null = texts.join('\n\n').trim() || null;
  // The share sheet often hands over text with a URL inside it.
  if (!url && text) {
    const m = text.match(/https?:\/\/\S+/);
    if (m) {
      url = m[0];
      text = text.replace(m[0], '').trim() || null;
    }
  }
  if (!url && !text && !images.length) return c.json({ error: 'nothing shared', message: 'Nothing came through to save.' }, 400);
  const result = await importUrl(c.env, url, text, images);
  const rid = await createRecipe(c.env, c.get('user'), { ...result.draft, tags: result.draft.tags ?? [] } as any);
  const link = new URL(result.structured ? `/recipes/${rid}` : `/recipes/${rid}/edit?${result.ai ? 'ai=1' : 'tidy=1'}`, c.req.url).toString();
  const message = result.structured || result.ai
    ? `Saved "${result.draft.title}" to Scullery.`
    : `Saved a draft to Scullery, but ${result.aiNote ? result.aiNote.replace(/\.$/, '').toLowerCase() : "I couldn't read the recipe"}. Open it to tidy up, or share a screenshot.`;
  return c.json({ id: rid, url: link, structured: result.structured, ai: !!result.ai, title: result.draft.title, message });
});

async function fileToImage(file: File): Promise<ImageInput | { error: string }> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const type = sniffImage(buf);
  if (!type) return { error: "That file isn't a photo I can read. Try a screenshot." };
  // Claude takes images up to 5 MB once base64-encoded.
  if (buf.byteLength > 3_700_000) return { error: 'That image is too large. Try a normal screenshot.' };
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return { mediaType: type, data: btoa(bin) };
}

function sniffImage(b: Uint8Array): ImageInput['mediaType'] | null {
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50) return 'image/png';
  if (b[0] === 0x47 && b[1] === 0x49) return 'image/gif';
  if (b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return null;
}

// Photos stored in R2, served back through the Worker.
app.post('/photos', async (c) => {
  if (!c.env.PHOTOS) return c.json({ error: 'Photo uploads are not switched on yet. Paste an image link instead.' }, 503);
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
  if (!c.env.PHOTOS) return c.json({ error: 'not found' }, 404);
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
