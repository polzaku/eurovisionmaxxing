/**
 * Supabase database types — mirrors the SQL schema.
 * These are the raw row shapes returned by Supabase queries.
 * Use the domain types in ./index.ts for app-level logic.
 */

export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          display_name: string;
          avatar_seed: string;
          rejoin_token_hash: string;
          created_at: string;
          last_seen_at: string;
        };
        Insert: {
          id?: string;
          display_name: string;
          avatar_seed: string;
          rejoin_token_hash: string;
          created_at?: string;
          last_seen_at?: string;
        };
        Update: {
          display_name?: string;
          avatar_seed?: string;
          rejoin_token_hash?: string;
          last_seen_at?: string;
        };
        Relationships: [];
      };
      rooms: {
        Row: {
          id: string;
          pin: string;
          year: number;
          event: string;
          categories: Array<{ name: string; weight: number; hint?: string }>;
          owner_user_id: string;
          status: string;
          announcement_mode: string;
          announcement_order: string[] | null;
          announcing_user_id: string | null;
          current_announce_idx: number;
          delegate_user_id: string | null;
          announce_skipped_user_ids: string[];
          now_performing_id: string | null;
          allow_now_performing: boolean;
          voting_ends_at: string | null;
          voting_ended_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          pin: string;
          year: number;
          event: string;
          categories: Array<{ name: string; weight: number; hint?: string }>;
          owner_user_id: string;
          status?: string;
          announcement_mode?: string;
          announcement_order?: string[] | null;
          announcing_user_id?: string | null;
          current_announce_idx?: number;
          delegate_user_id?: string | null;
          announce_skipped_user_ids?: string[];
          now_performing_id?: string | null;
          allow_now_performing?: boolean;
          voting_ends_at?: string | null;
          voting_ended_at?: string | null;
        };
        Update: {
          pin?: string;
          year?: number;
          event?: string;
          categories?: Array<{ name: string; weight: number; hint?: string }>;
          status?: string;
          announcement_mode?: string;
          announcement_order?: string[] | null;
          announcing_user_id?: string | null;
          current_announce_idx?: number;
          delegate_user_id?: string | null;
          announce_skipped_user_ids?: string[];
          now_performing_id?: string | null;
          allow_now_performing?: boolean;
          voting_ends_at?: string | null;
          voting_ended_at?: string | null;
        };
        Relationships: [];
      };
      room_memberships: {
        Row: {
          room_id: string;
          user_id: string;
          joined_at: string;
          is_ready: boolean;
          ready_at: string | null;
          scores_locked_at: string | null;
          last_seen_at: string | null;
        };
        Insert: {
          room_id: string;
          user_id: string;
          joined_at?: string;
          is_ready?: boolean;
          ready_at?: string | null;
          scores_locked_at?: string | null;
          last_seen_at?: string | null;
        };
        Update: {
          is_ready?: boolean;
          ready_at?: string | null;
          scores_locked_at?: string | null;
          last_seen_at?: string | null;
        };
        Relationships: [];
      };
      votes: {
        Row: {
          id: string;
          room_id: string;
          user_id: string;
          contestant_id: string;
          scores: Record<string, number> | null;
          missed: boolean;
          hot_take: string | null;
          /** SPEC §8.7.1 — set on subsequent edits, NULL on first save / after deletion. */
          hot_take_edited_at: string | null;
          /** SPEC §8.7.2 — admin who deleted the hot-take (NULL when author self-deletes via clearing the textarea). */
          hot_take_deleted_by_user_id: string | null;
          /** SPEC §8.7.2 — timestamp of admin deletion. */
          hot_take_deleted_at: string | null;
          updated_at: string;
        };
        Insert: {
          id?: string;
          room_id: string;
          user_id: string;
          contestant_id: string;
          scores?: Record<string, number> | null;
          missed?: boolean;
          hot_take?: string | null;
          hot_take_edited_at?: string | null;
          hot_take_deleted_by_user_id?: string | null;
          hot_take_deleted_at?: string | null;
        };
        Update: {
          scores?: Record<string, number> | null;
          missed?: boolean;
          hot_take?: string | null;
          hot_take_edited_at?: string | null;
          hot_take_deleted_by_user_id?: string | null;
          hot_take_deleted_at?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      results: {
        Row: {
          room_id: string;
          user_id: string;
          contestant_id: string;
          weighted_score: number;
          rank: number;
          points_awarded: number;
          announced: boolean;
        };
        Insert: {
          room_id: string;
          user_id: string;
          contestant_id: string;
          weighted_score: number;
          rank: number;
          points_awarded: number;
          announced?: boolean;
        };
        Update: {
          announced?: boolean;
        };
        Relationships: [];
      };
      room_awards: {
        Row: {
          room_id: string;
          award_key: string;
          award_name: string;
          winner_user_id: string | null;
          winner_user_id_b: string | null;
          winner_contestant_id: string | null;
          stat_value: number | null;
          stat_label: string | null;
        };
        Insert: {
          room_id: string;
          award_key: string;
          award_name: string;
          winner_user_id?: string | null;
          winner_user_id_b?: string | null;
          winner_contestant_id?: string | null;
          stat_value?: number | null;
          stat_label?: string | null;
        };
        Update: {
          award_name?: string;
          winner_user_id?: string | null;
          winner_user_id_b?: string | null;
          winner_contestant_id?: string | null;
          stat_value?: number | null;
          stat_label?: string | null;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
  };
}
