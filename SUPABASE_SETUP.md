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

1. Go to **Settings** (gear icon in sidebar) → **API**
2. You'll see two values you need:
   - **Project URL** — looks like `https://abcdefgh.supabase.co`
   - **anon / public** key — the long `eyJ...` string under "Project API keys"
   - **service_role** key — click "Reveal" next to it (keep this secret!)
3. Open `.env.local` in the project root and paste them in:

```
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...your-anon-key
SUPABASE_SERVICE_ROLE_KEY=eyJ...your-service-role-key
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

1. Go to **Database** → **Replication** in the sidebar
2. Under "Realtime," make sure these tables have replication enabled:
   - `rooms`
   - `room_memberships`
   - `votes`
   - `results`
3. The schema.sql should have done this automatically, but double-check here

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

Open [http://localhost:3000](http://localhost:3000) — you should see the landing page.

---

## Keeping it alive (free tier)

Supabase free-tier projects pause after 1 week of inactivity. To prevent this:

1. Set up a free [UptimeRobot](https://uptimerobot.com) monitor
2. Point it at your deployed app URL (e.g. `https://eurovisionmaxxing.vercel.app`)
3. Set check interval to 5 minutes
4. This keeps the Supabase project active by generating regular API calls

---

## Deploying to Vercel

1. Push the repo to GitHub
2. Go to [vercel.com](https://vercel.com) → **New Project** → Import the repo
3. Add the same 3 environment variables from `.env.local` in the Vercel dashboard:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
4. Click **Deploy**
5. Update `NEXT_PUBLIC_APP_URL` if you set up a custom domain

---

## Troubleshooting

**"relation does not exist" errors:** You haven't run the schema SQL yet. Go to Step 3.

**"JWT expired" or auth errors:** Check that your anon key and service role key are correct in `.env.local`. The service role key is used server-side (API routes) and the anon key client-side.

**Realtime not working:** Check Step 4. Also make sure you're subscribing to the correct channel name format (`room:{roomId}`).

**Tables exist but no RLS policies:** Re-run just the RLS section of `schema.sql` from the `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` line onwards.
