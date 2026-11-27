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

In `wrangler.jsonc`, paste the `database_id` in place of `REPLACE_WITH_D1_ID`. Then:

```sh
npx wrangler secret put ALLOWED_EMAILS      # your Google emails, comma separated
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

**Adding someone later:** run `npx wrangler secret put ALLOWED_EMAILS` again with their email added (and add them as a Google test user). Everyone on the list shares the same recipes.

### 3. iPhone share sheet Shortcuts

iOS doesn't let web apps appear in the share sheet, so two small Shortcuts send things to Scullery instead. One is for links and text, and one is for screenshots. With the Claude key set, the recipe is written for you and saved. You get a notification and don't need to open the app.

First, in Scullery go to **Settings → Create a key** and copy the key.

**Shortcut 1: Save to Scullery** (links and text)

In the **Shortcuts** app, tap **+**, name it **Save to Scullery**, and add:

1. Tap the **ⓘ** button at the bottom and turn on **Show in Share Sheet**. Back in the editor, tap the blue **Images and 18 more** at the top and leave only **URLs** and **Text** ticked.
2. Add **Get Contents of URL**:
   - URL: `https://<your Scullery URL>/api/share`
   - Tap **Show More**. Set Method to **POST**.
   - Headers: add `Authorization`, with the value `Bearer <your key>` (the word Bearer, a space, then the key).
   - Request Body: **JSON**. Add a **Text** field named `text`, and set its value to the **Shortcut Input** variable.
3. Add **Get Dictionary Value**: get the **Value** for key `message` in **Contents of URL**.
4. Add **Show Notification** with the **Dictionary Value**.

**Shortcut 2: Screenshot to Scullery** (for posts whose caption Scullery can't read)

The same steps with three differences: in step 1, leave only **Images** ticked. In step 2, set Request Body to **Form**, add a **File** field named `image`, and set it to **Shortcut Input**. Name it **Screenshot to Scullery**.

**Using them:** in Instagram, TikTok, YouTube or Safari, tap **Share** (for Instagram, the paper plane, then **Share to…** or **More**), then **Save to Scullery**. Wait 10 to 30 seconds for the notification. If it says it couldn't read the recipe, take a screenshot of the caption, tap the screenshot thumbnail, tap **Share**, then **Screenshot to Scullery**.

### 4. Claude (optional AI features)

With an Anthropic API key from console.anthropic.com, Scullery can:

- **Import from anything.** When a page has no structured recipe (or it's a YouTube video, Instagram/TikTok caption, pasted text or screenshots), Claude writes the recipe and you check it before using it. Pages with schema.org recipe data are still imported directly, without Claude.
- **Make it healthier.** Claude proposes swaps as a new version; nothing changes unless you accept it.
- **Ask Claude** about the recipe you're viewing.

Set the key as a secret (it prompts for the value; never commit it):

```sh
npx wrangler secret put ANTHROPIC_API_KEY
```

Without the secret, these buttons are hidden and import works as before. The model is set in `worker/ai.ts`. Each call logs its token usage (`npx wrangler tail`). Setting a monthly spend limit in the Anthropic Console is a good idea.

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
