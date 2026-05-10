-- ============================================================================
-- eurovisionmaxxing — Supabase PostgreSQL schema
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor → New Query)
-- ============================================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── USERS ──────────────────────────────────────────────────────────────────

CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  display_name    VARCHAR(24) NOT NULL,
  avatar_seed     VARCHAR(64) NOT NULL,
  rejoin_token_hash VARCHAR(60) NOT NULL,  -- bcrypt hash
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─── ROOMS ──────────────────────────────────────────────────────────────────

CREATE TABLE rooms (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pin                   VARCHAR(7) NOT NULL UNIQUE,
  year                  SMALLINT NOT NULL,
  event                 VARCHAR(6) NOT NULL CHECK (event IN ('semi1', 'semi2', 'final')),
  categories            JSONB NOT NULL,         -- [{name, weight, hint}]
  owner_user_id         UUID REFERENCES users(id),
  status                VARCHAR(14) NOT NULL DEFAULT 'lobby'
                          CHECK (status IN ('lobby','voting','voting_ending','scoring','announcing','done')),
  announcement_mode     VARCHAR(7) NOT NULL DEFAULT 'instant'
                          CHECK (announcement_mode IN ('live','instant')),
  announcement_order    UUID[],                 -- ordered array of userIds for live mode
  announcing_user_id    UUID REFERENCES users(id),
  current_announce_idx  SMALLINT DEFAULT 0,     -- which point value is being announced
  delegate_user_id      UUID REFERENCES users(id), -- admin handoff (SPEC §10.2 step 7); null when announcer drives directly
  announce_skipped_user_ids UUID[] NOT NULL DEFAULT '{}', -- §10.2.1: announcers the admin has manually skipped (absent at their turn)
  now_performing_id     VARCHAR(20),            -- contestant id currently performing
  allow_now_performing  BOOLEAN DEFAULT FALSE,
  batch_reveal_mode     BOOLEAN NOT NULL DEFAULT FALSE,
  voting_ends_at        TIMESTAMPTZ,            -- §6.3.1: deadline for the 5-s undo window; set on voting → voting_ending; cleared on undo
  voting_ended_at       TIMESTAMPTZ,            -- §6.3.1: audit timestamp written when voting_ending → scoring fires
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

-- Existing-database migrations (run via Supabase SQL Editor on rooms with existing data):
--   ALTER TABLE rooms ADD COLUMN IF NOT EXISTS delegate_user_id UUID REFERENCES users(id);
--   ALTER TABLE rooms ADD COLUMN IF NOT EXISTS announce_skipped_user_ids UUID[] NOT NULL DEFAULT '{}';
--   ALTER TABLE rooms ADD COLUMN IF NOT EXISTS batch_reveal_mode BOOLEAN NOT NULL DEFAULT FALSE;
--   ALTER TABLE room_memberships ADD COLUMN IF NOT EXISTS scores_locked_at TIMESTAMPTZ;
--   ALTER TABLE room_memberships ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
--
-- Existing-database migration for the §6.3.1 undo window (run via Supabase SQL Editor).
-- The two RLS policies on results + room_awards reference rooms.status, so they
-- must be dropped before the column type change and recreated after. See
-- SUPABASE_SETUP.md changelog for the full block.

-- ─── ROOM MEMBERSHIPS ───────────────────────────────────────────────────────

CREATE TABLE room_memberships (
  room_id           UUID REFERENCES rooms(id) ON DELETE CASCADE,
  user_id           UUID REFERENCES users(id),
  joined_at         TIMESTAMPTZ DEFAULT NOW(),
  is_ready          BOOLEAN DEFAULT FALSE,            -- for instant mode "ready to reveal"
  ready_at          TIMESTAMPTZ,                      -- timestamp when is_ready transitioned to true; MIN across the room is the 60-s countdown anchor in §10.1
  scores_locked_at  TIMESTAMPTZ,                      -- soft lock-in for vote calibration (§8.10); NULL = unlocked / never locked. Cleared automatically on any vote write by this user.
  last_seen_at      TIMESTAMPTZ,                      -- heartbeat timestamp for presence check; NULL = absent. Used by advance-time cascade-skip (SPEC §10.2.1).
  PRIMARY KEY (room_id, user_id)
);

-- ─── VOTES ──────────────────────────────────────────────────────────────────

CREATE TABLE votes (
  id                              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id                         UUID REFERENCES rooms(id) ON DELETE CASCADE,
  user_id                         UUID REFERENCES users(id),
  contestant_id                   VARCHAR(20) NOT NULL,    -- "{year}-{countryCode}"
  scores                          JSONB,                   -- {categoryName: score} NULL if missed & unfilled
  missed                          BOOLEAN DEFAULT FALSE,
  hot_take                        VARCHAR(140),
  hot_take_edited_at              TIMESTAMPTZ,             -- §8.7.1 — set on subsequent edits, NULL on first save / after delete
  hot_take_deleted_by_user_id     UUID REFERENCES users(id), -- §8.7.2 — admin who deleted (NULL on author self-delete)
  hot_take_deleted_at             TIMESTAMPTZ,             -- §8.7.2 — set when admin deletes
  updated_at                      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (room_id, user_id, contestant_id)
);

-- Migrations for existing deployments (additive, idempotent):
-- ALTER TABLE votes ADD COLUMN IF NOT EXISTS hot_take_edited_at TIMESTAMPTZ;
-- ALTER TABLE votes ADD COLUMN IF NOT EXISTS hot_take_deleted_by_user_id UUID REFERENCES users(id);
-- ALTER TABLE votes ADD COLUMN IF NOT EXISTS hot_take_deleted_at TIMESTAMPTZ;

-- ─── RESULTS ────────────────────────────────────────────────────────────────

CREATE TABLE results (
  room_id           UUID REFERENCES rooms(id) ON DELETE CASCADE,
  user_id           UUID REFERENCES users(id),
  contestant_id     VARCHAR(20) NOT NULL,
  weighted_score    NUMERIC(5,3) NOT NULL,
  rank              SMALLINT NOT NULL,
  points_awarded    SMALLINT NOT NULL,          -- 0,1,2,3,4,5,6,7,8,10,12
  announced         BOOLEAN DEFAULT FALSE,
  PRIMARY KEY (room_id, user_id, contestant_id)
);

-- ─── ROOM AWARDS ────────────────────────────────────────────────────────────

CREATE TABLE room_awards (
  room_id         UUID REFERENCES rooms(id) ON DELETE CASCADE,
  award_key       VARCHAR(30) NOT NULL,         -- e.g. "harshest_critic"
  award_name      VARCHAR(50) NOT NULL,         -- display name
  winner_user_id  UUID REFERENCES users(id),    -- null for contestant awards
  winner_user_id_b UUID REFERENCES users(id),   -- SPEC §11.2 — paired slot (Neighbourhood voters; 2-way personality ties)
  winner_contestant_id VARCHAR(20),             -- null for user awards
  stat_value      NUMERIC(6,3),                 -- the underlying metric
  stat_label      VARCHAR(80),                  -- human-readable stat description
  PRIMARY KEY (room_id, award_key)
);

-- Existing-database migration (run via Supabase SQL Editor):
--   ALTER TABLE room_awards ADD COLUMN IF NOT EXISTS winner_user_id_b UUID REFERENCES users(id);

-- ─── INDEXES ────────────────────────────────────────────────────────────────

CREATE INDEX idx_rooms_pin ON rooms(pin);
CREATE INDEX idx_rooms_status ON rooms(status);
CREATE INDEX idx_votes_room_user ON votes(room_id, user_id);
CREATE INDEX idx_votes_room_contestant ON votes(room_id, contestant_id);
CREATE INDEX idx_results_room ON results(room_id);
CREATE INDEX idx_room_memberships_user ON room_memberships(user_id);

-- ─── ROW LEVEL SECURITY ────────────────────────────────────────────────────
-- Note: API routes use the service_role key, so RLS is bypassed server-side.
-- These policies protect against direct client-side Supabase access.

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE results ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_awards ENABLE ROW LEVEL SECURITY;

-- Public read for rooms (needed for join-by-pin)
CREATE POLICY "Rooms are viewable by everyone"
  ON rooms FOR SELECT USING (true);

-- Public read for results when room is done/announcing
CREATE POLICY "Results viewable when room is announcing or done"
  ON results FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM rooms
      WHERE rooms.id = results.room_id
      AND rooms.status IN ('announcing', 'done')
    )
  );

-- Public read for awards when room is done
CREATE POLICY "Awards viewable when room is done"
  ON room_awards FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM rooms
      WHERE rooms.id = room_awards.room_id
      AND rooms.status IN ('announcing', 'done')
    )
  );

-- Room memberships readable by room members
CREATE POLICY "Room memberships viewable by room members"
  ON room_memberships FOR SELECT
  USING (true);

-- Users are readable by everyone (display name + avatar only)
CREATE POLICY "Users are viewable by everyone"
  ON users FOR SELECT USING (true);

-- Votes readable by everyone once room is announcing/done, own votes always readable
CREATE POLICY "Votes viewable by owner or when room is announcing/done"
  ON votes FOR SELECT
  USING (true);

-- ─── REALTIME ───────────────────────────────────────────────────────────────
-- Enable realtime on rooms table for broadcast

ALTER PUBLICATION supabase_realtime ADD TABLE rooms;
ALTER PUBLICATION supabase_realtime ADD TABLE room_memberships;
ALTER PUBLICATION supabase_realtime ADD TABLE votes;
ALTER PUBLICATION supabase_realtime ADD TABLE results;
