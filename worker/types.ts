export interface Env {
  DB: D1Database;
  PHOTOS: R2Bucket;
  ASSETS: Fetcher;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  ALLOWED_EMAILS: string;
}

export interface User {
  id: string;
  household_id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
}

export type AppEnv = { Bindings: Env; Variables: { user: User } };
