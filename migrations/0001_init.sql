-- Scullery initial schema (Cloudflare D1 / SQLite)
-- Everything belongs to a household so more people can join later.

CREATE TABLE households (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Emails allowed to sign in, and which household they join.
CREATE TABLE allowed_emails (
  email TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id)
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  avatar_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,          -- sha256 of the cookie token
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL
);

-- Personal API tokens (used by the iOS Shortcut).
CREATE TABLE api_tokens (
  id TEXT PRIMARY KEY,          -- sha256 of the token
  user_id TEXT NOT NULL REFERENCES users(id),
  label TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A recipe's current state lives in recipe_versions; recipes points at the latest.
CREATE TABLE recipes (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  current_version_id TEXT,
  source_url TEXT,
  source_kind TEXT NOT NULL DEFAULT 'manual', -- web | youtube | instagram | tiktok | manual
  image_key TEXT,                             -- R2 key or external URL
  archived INTEGER NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX recipes_household ON recipes(household_id, updated_at);

-- Immutable snapshots. body is JSON of the standardized recipe (see shared/recipe.ts).
CREATE TABLE recipe_versions (
  id TEXT PRIMARY KEY,
  recipe_id TEXT NOT NULL REFERENCES recipes(id),
  version_no INTEGER NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  change_note TEXT,
  from_cook_log_id TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(recipe_id, version_no)
);

CREATE TABLE tags (
  household_id TEXT NOT NULL,
  recipe_id TEXT NOT NULL REFERENCES recipes(id),
  tag TEXT NOT NULL,
  PRIMARY KEY (recipe_id, tag)
);
CREATE INDEX tags_by_name ON tags(household_id, tag);

-- Cook log entries; edits are kept in cook_log_revisions.
CREATE TABLE cook_logs (
  id TEXT PRIMARY KEY,
  recipe_id TEXT NOT NULL REFERENCES recipes(id),
  recipe_version_id TEXT REFERENCES recipe_versions(id),
  household_id TEXT NOT NULL,
  cooked_on TEXT NOT NULL,       -- YYYY-MM-DD
  rating INTEGER,                -- 1..5
  how_it_went TEXT,
  next_time TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX cook_logs_recipe ON cook_logs(recipe_id, cooked_on);

CREATE TABLE cook_log_revisions (
  id TEXT PRIMARY KEY,
  cook_log_id TEXT NOT NULL REFERENCES cook_logs(id),
  snapshot TEXT NOT NULL,        -- JSON of the entry before the edit
  edited_by TEXT REFERENCES users(id),
  edited_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Meal plan: one row per planned dish.
CREATE TABLE meal_plan (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  plan_date TEXT NOT NULL,       -- YYYY-MM-DD
  meal TEXT NOT NULL DEFAULT 'dinner', -- breakfast | lunch | dinner | other
  recipe_id TEXT REFERENCES recipes(id),
  note TEXT,                     -- for non-recipe items ("leftovers")
  servings REAL,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX meal_plan_date ON meal_plan(household_id, plan_date);

CREATE TABLE shopping_lists (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  name TEXT NOT NULL,
  from_date TEXT,
  to_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE shopping_items (
  id TEXT PRIMARY KEY,
  list_id TEXT NOT NULL REFERENCES shopping_lists(id),
  name TEXT NOT NULL,
  quantity REAL,
  unit TEXT,
  aisle TEXT NOT NULL DEFAULT 'Other',
  checked INTEGER NOT NULL DEFAULT 0,
  sources TEXT,                  -- JSON list of recipe titles it came from
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX shopping_items_list ON shopping_items(list_id);
