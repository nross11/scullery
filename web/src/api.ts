import type { RecipeBody, RecipeDraft } from '../../shared/recipe';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  if (res.status === 401) {
    if (!location.pathname.startsWith('/login')) location.href = '/login';
    throw new ApiError(401, 'Signed out');
  }
  if (!res.ok) {
    let msg = res.statusText;
    try {
      msg = ((await res.json()) as { error?: string }).error ?? msg;
    } catch { /* not json */ }
    throw new ApiError(res.status, msg);
  }
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(p: string) => req<T>('GET', p),
  post: <T>(p: string, b?: unknown) => req<T>('POST', p, b ?? {}),
  put: <T>(p: string, b: unknown) => req<T>('PUT', p, b),
  del: <T>(p: string) => req<T>('DELETE', p),
  async upload(file: File): Promise<string> {
    const res = await fetch('/api/photos', { method: 'POST', headers: { 'content-type': file.type }, body: file });
    if (!res.ok) throw new ApiError(res.status, 'Upload failed');
    return ((await res.json()) as { url: string }).url;
  },
};

export interface Me {
  id: string; email: string; name: string | null; avatar_url: string | null; household_id: string;
  members: { name: string | null; email: string; avatar_url: string | null }[];
}

export interface RecipeSummary {
  id: string; title: string; image_key: string | null; source_kind: string; updated_at: string;
  tags: string[]; last_cooked: string | null; avg_rating: number | null; times_cooked: number;
}

export interface CookLog {
  id: string; recipe_id: string; cooked_on: string; rating: number | null; how_it_went: string | null;
  next_time: string | null; author_name: string | null; version_no: number | null; revisions: number; updated_at: string;
}

export interface Recipe {
  id: string; title: string; body: RecipeBody; versionNo: number; sourceUrl: string | null; sourceKind: string;
  imageUrl: string | null; tags: string[]; cookLogs: CookLog[]; createdAt: string; updatedAt: string;
}

export interface ImportResponse { structured: boolean; fetched: boolean; draft: RecipeDraft }

export interface PlanEntry {
  id: string; plan_date: string; meal: string; recipe_id: string | null; note: string | null; servings: number | null;
  recipe_title: string | null; image_key: string | null; base_servings: number | null;
}
