import type { Context, MiddlewareHandler } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { Hono } from 'hono';
import type { AppEnv, Env, User } from './types';
import { id } from './util';

const SESSION_COOKIE = 'scullery_session';
const STATE_COOKIE = 'scullery_oauth_state';
const SESSION_DAYS = 90;

export async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomToken(bytes = 32): string {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function redirectUri(c: Context): string {
  return new URL('/api/auth/callback', c.req.url).toString();
}

/** Gmail ignores dots and "+tags" in the name part, so "a.b@gmail.com" and "ab@gmail.com" are the same account. */
export function canonicalEmail(email: string): string {
  const [name, domain] = email.trim().toLowerCase().split('@');
  if (domain === 'gmail.com' || domain === 'googlemail.com') return `${name.split('+')[0].replace(/\./g, '')}@gmail.com`;
  return `${name}@${domain}`;
}

/** Work out which household an email belongs to, or null if not allowed. */
async function householdFor(env: Env, rawEmail: string): Promise<string | null> {
  const email = canonicalEmail(rawEmail);
  const row = await env.DB.prepare('SELECT household_id FROM allowed_emails WHERE email = ?').bind(email).first<{ household_id: string }>();
  if (row) return row.household_id;
  const envList = (env.ALLOWED_EMAILS || '').split(',').map((e) => e.trim()).filter(Boolean).map(canonicalEmail);
  if (!envList.includes(email)) return null;
  // Everyone listed in ALLOWED_EMAILS shares the first household (created on first sign-in).
  let hh = await env.DB.prepare('SELECT id FROM households ORDER BY created_at LIMIT 1').first<{ id: string }>();
  if (!hh) {
    hh = { id: id() };
    await env.DB.prepare('INSERT INTO households (id, name) VALUES (?, ?)').bind(hh.id, 'Our kitchen').run();
  }
  await env.DB.prepare('INSERT OR IGNORE INTO allowed_emails (email, household_id) VALUES (?, ?)').bind(email, hh.id).run();
  return hh.id;
}

export const authRoutes = new Hono<AppEnv>();

authRoutes.get('/google', (c) => {
  const state = randomToken(16);
  setCookie(c, STATE_COOKIE, state, { httpOnly: true, secure: true, sameSite: 'Lax', path: '/api/auth', maxAge: 600 });
  const params = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(c),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });
  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

authRoutes.get('/callback', async (c) => {
  const { code, state } = c.req.query();
  const expected = getCookie(c, STATE_COOKIE);
  deleteCookie(c, STATE_COOKIE, { path: '/api/auth' });
  if (!code || !state || state !== expected) return c.redirect('/login?error=state');

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: c.env.GOOGLE_CLIENT_ID,
      client_secret: c.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri(c),
      grant_type: 'authorization_code',
    }),
  });
  if (!tokenRes.ok) return c.redirect('/login?error=token');
  const tokens = (await tokenRes.json()) as { id_token?: string };
  if (!tokens.id_token) return c.redirect('/login?error=token');

  // The ID token came straight from Google's token endpoint over TLS, so we can read its claims
  // without verifying the signature (per Google's OpenID Connect docs). We still check aud/iss/expiry.
  const payload = JSON.parse(atob(tokens.id_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) as {
    aud: string; iss: string; exp: number; email: string; email_verified: boolean; name?: string; picture?: string; sub: string;
  };
  if (
    payload.aud !== c.env.GOOGLE_CLIENT_ID ||
    !['accounts.google.com', 'https://accounts.google.com'].includes(payload.iss) ||
    payload.exp * 1000 < Date.now() ||
    !payload.email_verified
  ) {
    return c.redirect('/login?error=claims');
  }
  const email = payload.email.toLowerCase();
  const householdId = await householdFor(c.env, email);
  if (!householdId) return c.redirect('/login?error=not_allowed');

  let user = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first<{ id: string }>();
  if (!user) {
    user = { id: id() };
    await c.env.DB.prepare('INSERT INTO users (id, household_id, email, name, avatar_url) VALUES (?, ?, ?, ?, ?)')
      .bind(user.id, householdId, email, payload.name ?? null, payload.picture ?? null).run();
  } else {
    await c.env.DB.prepare('UPDATE users SET name = ?, avatar_url = ? WHERE id = ?')
      .bind(payload.name ?? null, payload.picture ?? null, user.id).run();
  }

  const token = randomToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
  await c.env.DB.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').bind(await sha256(token), user.id, expires).run();
  setCookie(c, SESSION_COOKIE, token, { httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: SESSION_DAYS * 86400 });
  return c.redirect('/');
});

authRoutes.post('/logout', async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(await sha256(token)).run();
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return c.json({ ok: true });
});

/** Accepts the session cookie, or `Authorization: Bearer <token>` for the iOS Shortcut. */
export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  let user: User | null = null;
  const bearer = c.req.header('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (bearer) {
    user = await c.env.DB.prepare(
      'SELECT u.id, u.household_id, u.email, u.name, u.avatar_url FROM api_tokens t JOIN users u ON u.id = t.user_id WHERE t.id = ?',
    ).bind(await sha256(bearer)).first<User>();
  } else {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) {
      user = await c.env.DB.prepare(
        "SELECT u.id, u.household_id, u.email, u.name, u.avatar_url FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')",
      ).bind(await sha256(token)).first<User>();
    }
  }
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  c.set('user', user);
  await next();
};

export async function createApiToken(env: Env, userId: string, label: string): Promise<string> {
  const token = randomToken();
  await env.DB.prepare('INSERT INTO api_tokens (id, user_id, label) VALUES (?, ?, ?)').bind(await sha256(token), userId, label).run();
  return token;
}
