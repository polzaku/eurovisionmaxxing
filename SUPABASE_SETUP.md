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

- **2026-05-03 — R4 §10.2.1:** added `rooms.announce_skipped_user_ids UUID[] NOT NULL DEFAULT '{}'` so the admin can mark absent announcers as skipped during a live reveal. Apply with:

  ```sql
  ALTER TABLE rooms
    ADD COLUMN IF NOT EXISTS announce_skipped_user_ids UUID[] NOT NULL DEFAULT '{}';
  ```

- **2026-04-27 — R0 + R4 §6.3.1:** added `voting_ending` status to `rooms.status` CHECK (and bumped column to VARCHAR(14)), plus two nullable timestamp columns (`voting_ends_at` for the 5-s undo deadline, `voting_ended_at` for the audit trail).

  The `results` and `room_awards` RLS policies reference `rooms.status`, so PostgreSQL refuses the column-type change while they exist. Drop them, alter the column, then recreate them:

  ```sql
  -- Drop the two policies that depend on rooms.status
  DROP POLICY IF EXISTS "Results viewable when room is announcing or done" ON results;
  DROP POLICY IF EXISTS "Awards viewable when room is done" ON room_awards;

  -- Apply the column changes
  ALTER TABLE rooms ALTER COLUMN status TYPE VARCHAR(14);
  ALTER TABLE rooms DROP CONSTRAINT IF EXISTS rooms_status_check;
  ALTER TABLE rooms ADD CONSTRAINT rooms_status_check
    CHECK (status IN ('lobby','voting','voting_ending','scoring','announcing','done'));
  ALTER TABLE rooms ADD COLUMN IF NOT EXISTS voting_ends_at TIMESTAMPTZ;
  ALTER TABLE rooms ADD COLUMN IF NOT EXISTS voting_ended_at TIMESTAMPTZ;

  -- Recreate the policies (identical to schema.sql)
  CREATE POLICY "Results viewable when room is announcing or done"
    ON results FOR SELECT
    USING (
      EXISTS (
        SELECT 1 FROM rooms
        WHERE rooms.id = results.room_id
        AND rooms.status IN ('announcing', 'done')
      )
    );

  CREATE POLICY "Awards viewable when room is done"
    ON room_awards FOR SELECT
    USING (
      EXISTS (
        SELECT 1 FROM rooms
        WHERE rooms.id = room_awards.room_id
        AND rooms.status IN ('announcing', 'done')
      )
    );
  ```

- **2026-04-26 — Phase S0:** added `room_memberships.scores_locked_at TIMESTAMPTZ` (nullable, default NULL) for the Phase S3 calibration drawer's soft lock-in. Apply with:

  ```sql
  ALTER TABLE room_memberships
    ADD COLUMN IF NOT EXISTS scores_locked_at TIMESTAMPTZ;
  ```

- **2026-04-27 — Phase 5c.1**: added `room_memberships.ready_at TIMESTAMPTZ` (nullable, default NULL) for the instant-mode 60-s countdown anchor. Apply with:

  ```sql
  ALTER TABLE room_memberships
    ADD COLUMN IF NOT EXISTS ready_at TIMESTAMPTZ;
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

## Contestant data refresh runbook (SPEC §5.1c)

The hardcoded fallback at `data/contestants/{year}/{event}.json` is load-bearing whenever the EurovisionAPI lags behind a public announcement (allocation draw, withdrawal, late-season correction). This runbook is what an on-call operator follows when one of those events fires.

### Owners

- **Primary:** Valeriia Kulynych (repo maintainer).
- **On-call backup:** _TBD — name a second person here before the first show of the season._ Required by SPEC §5.1c so the show isn't single-point-of-failure on the maintainer's availability.

### When to run it

- **Allocation draw** for each semi-final. Typically ~2 weeks before the semi airs. EurovisionAPI may return an empty list, an alphabetical list, or no `runningOrder` until then; the canonical broadcast order is published the moment the draw concludes.
- **Contestant withdrawal** announcements. Can happen any time between the draw and the show.
- **Opening show day** for each event — final verification within 24 h of broadcast.

### The 5-minute process

1. Run the fetch script (lands as part of Phase R6):

   ```bash
   npm run fetch-contestants -- --year=2026 --event=semi1   # or semi2 | final
   ```

   It hits EurovisionAPI with the §5.1 cascade and writes the normalised JSON to `data/contestants/{year}/{event}.json`.

2. If the API returns empty or invalid data, the script exits non-zero. Fall back to manual transcription from the [eurovision.tv](https://eurovision.tv) official announcement — paste into the JSON using the four-field shape from SPEC §5.2 (`country`, `artist`, `song`, `runningOrder`).

3. Diff-check before committing:

   ```bash
   git diff data/contestants/
   ```

   Expected: running-order shuffles, new artist additions, spelling fixes. **Unexpected deletions require manual review** — the EurovisionAPI has historically returned partial lists during outages, and silently committing one would wipe contestants from existing rooms on next deploy.

4. Commit with a structured subject line:

   ```
   Update {year}/{event} running order — {source}
   ```

   where `{source}` is `api` or `manual-{yyyy-mm-dd}` (the date you transcribed from eurovision.tv).

5. Push to `main`. Vercel auto-deploys; no further action.

### Verifying the deploy

After Vercel reports a successful deploy (typically 60–90 s after push):

```bash
curl -s "https://eurovisionmaxxing.com/api/contestants?year=2026&event=semi1" | jq '. | length'
```

Should return the expected contestant count. Spot-check a couple of `runningOrder` values against the eurovision.tv announcement.

### What this does **not** do

- Does **not** disturb existing rooms. Running orders refresh on the server, but rooms only re-load contestants when an admin taps **Refresh contestants** in lobby (SPEC §5.1d) — voting and announcement state are untouched.
- Does **not** require a database change. Contestants are static JSON, not stored in Supabase.

---

## Troubleshooting

**"relation does not exist" errors:** You haven't run the schema SQL yet. Go to Step 3.

**"JWT expired" or auth errors:** Check that your publishable and secret keys are correct in `.env.local` (from **Project Settings → API Keys**). The secret key is used server-side (API routes) and the publishable key client-side.

**Realtime not working:** Check Step 4. Also make sure you're subscribing to the correct channel name format (`room:{roomId}`).

**Tables exist but no RLS policies:** Re-run just the RLS section of `schema.sql` from the `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` line onwards.
