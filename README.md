# Scullery

Our household recipe book: import recipes from the web, keep a cook log, see every version of a recipe, plan the week's meals and get a shopping list grouped by aisle.

- **App:** React + Vite, installable on iPhone as a home-screen app (PWA)
- **Server:** one Cloudflare Worker (`worker/`) that also serves the app
- **Data:** Cloudflare D1 (SQLite) for everything, R2 for uploaded photos
- **Sign-in:** Google, limited to the emails you list

## What's in v1

- **Import** from recipe websites using their schema.org Recipe data (most big recipe sites have it). YouTube, Instagram and TikTok links are saved with any caption you paste, and Scullery has a first go at splitting it into ingredients and steps for you to tidy.
- **Standard recipe view** with servings scaling, tick-off ingredients, tags, source link and photo.
- **Version history**: every edit (including renames) is a new version. You can view any version, compare it with the one before, and restore it. Restoring copies the old version forward, so nothing is lost.
- **Cook log**: date, rating, how it went, and what to change next time. Edits to log entries are kept too, and can be restored. "Apply to recipe" opens the editor with that cook's notes alongside, and saves the change as a new version linked to the cook.
- **Meal planner** by week, and **shopping lists** generated from it. Matching ingredients are combined ("1 onion" + "2 onions" = 3 onions; tbsp and tsp combine; g and kg combine). Things in different kinds of units stay as separate lines.
- **Cook mode**: one big step at a time, the screen stays on (where the browser supports the Wake Lock API), and one-tap timers for steps that mention minutes.
- **iPhone share sheet** via an Apple Shortcut (see below).

Not in v1 (planned for v2): chatting about a recipe, healthier swaps, AI extraction from videos.

## Setup

You need a free Cloudflare account and a Google account. Commands run from this folder on your computer, with Node 20+ installed.

### 1. Cloudflare

```sh
npm install
npx wrangler login                          # opens a browser to sign in to Cloudflare
npx wrangler d1 create scullery             # prints a database_id
npx wrangler r2 bucket create scullery-photos
```

> R2 may ask you to enable it on your account first, which needs a payment card on file even on the free tier (this is my understanding; check the Cloudflare dashboard).

In `wrangler.jsonc`:
- paste the `database_id` in place of `REPLACE_WITH_D1_ID`
- set `ALLOWED_EMAILS` to your Google emails, comma separated, e.g. `"you@gmail.com,partner@gmail.com"`

Then:

```sh
npm run db:migrate          # creates the tables
npm run deploy              # builds the app and deploys it
```

The deploy prints your URL, like `https://scullery.<your-subdomain>.workers.dev`. You need it for Google.

### 2. Google sign-in

1. Go to [console.cloud.google.com](https://console.cloud.google.com/) and create a project (call it Scullery).
2. Open **APIs & Services → OAuth consent screen** (newer consoles call this **Google Auth Platform**) and click **Get started**. App name: Scullery. Audience: **External**. Add your email as the contact.
3. Under **Audience**, leave it in **Testing** and add both of your Gmail addresses as **test users**. Only test users can sign in, which is what we want.
4. Under **Clients**, click **Create client**. Type: **Web application**. Under **Authorized redirect URIs**, add `https://<your Scullery URL>/api/auth/callback`
5. Copy the **Client ID** into `GOOGLE_CLIENT_ID` in `wrangler.jsonc`, then store the secret:

```sh
npx wrangler secret put GOOGLE_CLIENT_SECRET    # paste the client secret when asked
npm run deploy
```

Open your Scullery URL on each iPhone in Safari, sign in, then tap **Share → Add to Home Screen**.

**Adding someone later:** add their email to `ALLOWED_EMAILS` (and as a Google test user) and redeploy. Everyone on the list shares the same recipes.

### 3. iPhone share sheet Shortcut

iOS doesn't let web apps appear in the share sheet, so a small Shortcut sends links to Scullery instead.

First, in Scullery go to **Settings → Create a key** and copy the key.

Then in the **Shortcuts** app, tap **+** and build this:

1. Tap the **ⓘ** (details) button, turn on **Show in Share Sheet**, and set it to receive **URLs** and **Text**. Name the shortcut **Save to Scullery**.
2. Add **Get Contents of URL**:
   - URL: `https://<your Scullery URL>/api/share`
   - Method: **POST**
   - Headers: `Authorization` = `Bearer <your key>`
   - Request Body: **JSON**, with one field `text` (Text) set to the **Shortcut Input** variable
3. Add **Get Dictionary Value**: get the value for `url` in **Contents of URL**.
4. Add **Open URLs** with that **Dictionary Value**.

Now in Safari, YouTube, Instagram or TikTok: tap **Share → Save to Scullery**. Website recipes open ready to cook. Video links open in the editor so you can paste in the caption and tidy up.

## Development

```sh
cp .dev.vars.example .dev.vars          # local secret
npm run db:migrate:local
npm run build && npm run dev:api        # Worker + built app on :8787
npm run dev                             # Vite dev server on :5173, proxies /api to :8787
npm test                                # parser, importer and shopping-list tests
```

Code layout:
- `shared/` recipe format, ingredient parser, schema.org importer, shopping list combiner (used by both sides, unit tested)
- `worker/` API routes (Hono)
- `web/` React app
- `migrations/` D1 schema
