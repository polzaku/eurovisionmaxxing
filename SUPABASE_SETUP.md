# Supabase Setup Guide for eurovisionmaxxing

This gets you from zero to a working database in about 5 minutes.

---

## Step 1: Create a Supabase account & project

1. Go to [supabase.com](https://supabase.com) and sign up (GitHub login is fastest)
2. Click **New Project**
3. Fill in:
   - **Name:** `eurovisionmaxxing` (or whatever you like)
   - **Database Password:** generate a strong one and save it somewhere
   - **Region:** pick the one closest to your users (e.g. West EU for Eurovision parties)
   - **Plan:** Free tier is fine
4. Click **Create new project** — wait ~2 minutes for it to provision

## Step 2: Get your API keys

Once the project is ready:

1. Go to **Project Settings** (gear icon in sidebar) → **Data API** to find your **Project URL** (looks like `https://abcdefgh.supabase.co`).
2. Then go to **Project Settings** → **API Keys**. Stay on the **Publishable and secret API keys** tab (the new format — this project uses these, not the legacy JWT keys) and copy:
   - **Publishable key** — starts with `sb_publishable_...`
   - **Secret key** — click "Reveal" first, starts with `sb_secret_...` (keep this secret!)
3. Open `.env.local` in the project root and paste them in:

```
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SECRET_KEY=sb_secret_...
```

## Step 3: Run the database schema

1. In the Supabase dashboard, go to **SQL Editor** (left sidebar)
2. Click **New Query**
3. Open the file `supabase/schema.sql` from this project
4. Copy the entire contents and paste it into the SQL editor
5. Click **Run** (or Cmd+Enter)
6. You should see "Success. No rows returned" — that means all tables were created

To verify: go to **Table Editor** in the sidebar. You should see these tables:
- `users`
- `rooms`
- `room_memberships`
- `votes`
- `results`
- `room_awards`

## Step 4: Enable Realtime

1. Go to **Database** → **Publications** in the sidebar
2. Click the `supabase_realtime` publication
3. Make sure these tables are toggled on:
   - `rooms`
   - `room_memberships`
   - `votes`
   - `results`
4. The schema.sql should have done this automatically, but double-check here

## Step 5: Verify RLS is enabled

1. Go to **Authentication** → **Policies** in the sidebar
2. Each table should show "RLS enabled" with the policies created by the schema
3. If any table shows "RLS disabled," click it and enable it

## Step 6: Run the app

```bash
cd eurovisionmaxxing
npm install
npm run dev
```

Open [http://loca lhost:3000](http://localhost:3000) — you should see the landing page.

---

## Schema migrations

`supabase/schema.sql` is the canonical **fresh-install** definition. It uses bare `CREATE TABLE` / `CREATE INDEX` / `CREATE POLICY` statements, so re-applying the whole file against an existing project will fail with `relation "users" already exists` and similar errors.

For existing projects, run the per-migration SQL listed in the changelog below in the Supabase SQL Editor. Each statement is idempotent (uses `IF NOT EXISTS` or equivalent), so re-running is safe.

### Changelog

- **2026-04-26 — Phase S0:** added `room_memberships.scores_locked_at TIMESTAMPTZ` (nullable, default NULL) for the Phase S3 calibration drawer's soft lock-in. Apply with:

  ```sql
  ALTER TABLE room_memberships
    ADD COLUMN IF NOT EXISTS scores_locked_at TIMESTAMPTZ;
  ```

---

## Keeping it alive (free tier)

Supabase free-tier projects pause after 1 week of inactivity. To prevent this:

1. Set up a free [UptimeRobot](https://uptimerobot.com) monitor
2. Point it at `https://eurovisionmaxxing.com/api/health` — this endpoint runs a trivial Supabase query on every request, guaranteeing the DB is poked (monitoring just the homepage would only keep Vercel warm, not Supabase)
3. Set check interval to 5 minutes
4. UptimeRobot expects a 2xx response — `/api/health` returns `{ "ok": true }` on success or `503` if Supabase is unreachable

---

## Deploying to Vercel

The repo is already connected to Vercel via GitHub, so every push to `main` will auto-deploy.

### Environment variables

In the Vercel dashboard, go to your project → **Settings** → **Environment Variables** and add the same 3 variables from `.env.local`:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY`
- `NEXT_PUBLIC_APP_URL` — set to `https://eurovisionmaxxing.com`

Apply to all environments (Production, Preview, Development). After adding, trigger a redeploy so they take effect.

### Custom domain (eurovisionmaxxing.com via Cloudflare)

1. In Vercel: **Settings** → **Domains** → add `eurovisionmaxxing.com` and `www.eurovisionmaxxing.com`
2. Vercel will show you DNS records to add. You have two options in Cloudflare:

   **Option A — Cloudflare DNS only (recommended, simplest):**
   - In Cloudflare dashboard → your domain → **DNS** → **Records**
   - Add the A record / CNAME records Vercel shows you
   - **Important:** set the proxy status to **DNS only** (grey cloud, not orange) — otherwise Cloudflare's proxy will conflict with Vercel's SSL. You still get Cloudflare's DNS speed, just not the proxy/CDN layer (Vercel has its own CDN anyway).

   **Option B — Cloudflare proxy + Vercel:**
   - Keep the orange cloud on, but set Cloudflare SSL mode to **Full (strict)** under **SSL/TLS** → **Overview**
   - More config, only worth it if you specifically want Cloudflare's WAF/caching rules

3. Back in Vercel, wait for the domain to show "Valid Configuration" (usually 1–5 min)
4. SSL certs auto-provision

### Verify

- Visit `https://eurovisionmaxxing.com` — should load the app
- Check that `NEXT_PUBLIC_APP_URL` is being used correctly (e.g. in any share links)

---

## Troubleshooting

**"relation does not exist" errors:** You haven't run the schema SQL yet. Go to Step 3.

**"JWT expired" or auth errors:** Check that your publishable and secret keys are correct in `.env.local` (from **Project Settings → API Keys**). The secret key is used server-side (API routes) and the publishable key client-side.

**Realtime not working:** Check Step 4. Also make sure you're subscribing to the correct channel name format (`room:{roomId}`).

**Tables exist but no RLS policies:** Re-run just the RLS section of `schema.sql` from the `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` line onwards.
