#!/usr/bin/env tsx
/**
 * SPEC §17a.6 — companion cleanup for `seed-room.ts`. Wipes every room
 * with PIN starting `SEED` plus all dependent rows (memberships, votes,
 * results, awards) and the seeded users themselves.
 *
 * Usage:
 *   npm run seed:cleanup
 *
 * Safe to run unconditionally — only touches rows tagged with the `SEED`
 * prefix on `rooms.pin` or with display names beginning `Seed `.
 *
 * Same env-loading + safety gating as the seeder. Does NOT require any
 * positional arg.
 */

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../src/types/database";
import { SEED_PIN_PREFIX } from "./seed-helpers";

function bail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

function assertSafeEnvironment(): void {
  const allowProd = process.argv.includes("--allow-prod");
  if (process.env.NODE_ENV === "production" && !allowProd) {
    bail(
      "Refusing to clean against NODE_ENV=production. Pass --allow-prod " +
        "if you really mean it.",
    );
  }
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
    bail(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY. The npm " +
        "script loads .env.local — make sure it has both keys.",
    );
  }
}

async function main(): Promise<void> {
  assertSafeEnvironment();
  const db = createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
  );

  // 1. Find seeded room ids.
  const { data: rooms, error: roomsErr } = await db
    .from("rooms")
    .select("id, pin")
    .like("pin", `${SEED_PIN_PREFIX}%`);
  if (roomsErr) bail(`Failed to list seeded rooms: ${roomsErr.message}`);
  const roomIds = (rooms ?? []).map((r) => r.id);

  if (roomIds.length === 0) {
    console.log("No seeded rooms found — nothing to clean.");
    return;
  }

  console.log(`Found ${roomIds.length} seeded room(s):`);
  for (const r of rooms ?? []) console.log(`  • ${r.pin}  ${r.id}`);

  // 2. Wipe child rows first (no schema cascade documented in
  //    `supabase/schema.sql`, so we delete explicitly to be safe).
  const childTables = ["votes", "results", "room_awards", "room_memberships"] as const;
  for (const t of childTables) {
    const { error } = await db.from(t).delete().in("room_id", roomIds);
    if (error) bail(`Failed to delete from ${t}: ${error.message}`);
  }

  // 3. Wipe the rooms.
  const { error: roomDelErr } = await db
    .from("rooms")
    .delete()
    .in("id", roomIds);
  if (roomDelErr) bail(`Failed to delete rooms: ${roomDelErr.message}`);

  // 4. Wipe seeded users (display name prefix). Only those NOT still
  //    referenced by any non-seeded room — defence against accidentally
  //    deleting a real user named "Seed Foo". Users whose memberships
  //    have all been deleted are safe to remove.
  const { data: seedUsers, error: seedUsersErr } = await db
    .from("users")
    .select("id, display_name")
    .like("display_name", "Seed %");
  if (seedUsersErr) bail(`Failed to list seed users: ${seedUsersErr.message}`);
  const seedUserIds = (seedUsers ?? []).map((u) => u.id);

  if (seedUserIds.length > 0) {
    const { data: stillMember, error: memErr } = await db
      .from("room_memberships")
      .select("user_id")
      .in("user_id", seedUserIds);
    if (memErr) bail(`Failed to check membership: ${memErr.message}`);
    const stillMemberSet = new Set((stillMember ?? []).map((m) => m.user_id));
    const safeToDelete = seedUserIds.filter((u) => !stillMemberSet.has(u));
    if (safeToDelete.length > 0) {
      const { error: userDelErr } = await db
        .from("users")
        .delete()
        .in("id", safeToDelete);
      if (userDelErr) bail(`Failed to delete users: ${userDelErr.message}`);
      console.log(`  • Deleted ${safeToDelete.length} seed user row(s).`);
    }
  }

  console.log("");
  console.log(`✅ Cleaned ${roomIds.length} seeded room(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
