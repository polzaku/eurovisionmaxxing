"use client";

import Avatar from "@/components/ui/Avatar";

export interface RosterMember {
  userId: string;
  displayName: string;
  avatarSeed: string;
}

interface AnnouncerRosterProps {
  members: RosterMember[];
  /** UserIds currently subscribed to the room presence channel. */
  presenceUserIds: Set<string>;
  /** UserId of the current announcer — that row gets a marker. */
  currentAnnouncerId?: string | null;
  /** UserId of the active delegate, if any — that row gets a separate marker. */
  delegateUserId?: string | null;
  /**
   * UserIds the admin has manually skipped during this announce flow.
   * Per SPEC §10.2.1 they're rendered with a strikethrough so the admin
   * can see at a glance who's been bypassed.
   */
  skippedUserIds?: Set<string>;
}

/**
 * SPEC §10.2 step 7 — admin announcer roster.
 *
 * Display-only panel for the room owner during `announcing`. Lists every
 * member with a presence dot (green = subscribed to the room presence
 * channel, grey = not). The current announcer's row carries a 🎤 marker;
 * the delegate, if set, gets a 🛂 marker.
 *
 * Actions (handoff / skip / restore-skipped / reshuffle) live in the
 * existing owner-watching panel above the leaderboard for now — this
 * component is the visibility piece. Migrating those actions per-row
 * is a follow-on slice once the panel earns its keep.
 */
export default function AnnouncerRoster({
  members,
  presenceUserIds,
  currentAnnouncerId,
  delegateUserId,
  skippedUserIds,
}: AnnouncerRosterProps) {
  if (members.length === 0) return null;

  return (
    <section
      data-testid="announcer-roster"
      aria-label="Announcer roster"
      className="rounded-2xl border-2 border-border bg-card px-4 py-3 space-y-2"
    >
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Roster
        </h2>
        <p className="text-[10px] text-muted-foreground">
          <span
            aria-hidden
            className="inline-block w-2 h-2 rounded-full bg-emerald-500 mr-1 align-middle"
          />
          here now
        </p>
      </header>
      <ul className="space-y-1">
        {members.map((m) => {
          const isOnline = presenceUserIds.has(m.userId);
          const isAnnouncer = m.userId === currentAnnouncerId;
          const isDelegate = !!delegateUserId && m.userId === delegateUserId;
          const isSkipped = !!skippedUserIds?.has(m.userId);
          return (
            <li
              key={m.userId}
              data-testid={`roster-row-${m.userId}`}
              data-online={isOnline ? "true" : "false"}
              data-current-announcer={isAnnouncer ? "true" : "false"}
              data-skipped={isSkipped ? "true" : "false"}
              className={`flex items-center gap-3 rounded-lg px-2 py-1.5 ${
                isAnnouncer ? "bg-primary/10 border border-primary/40" : ""
              }`}
            >
              <span
                aria-hidden
                title={isOnline ? "Online" : "Offline"}
                className={`relative inline-block w-2 h-2 rounded-full ${
                  isOnline ? "bg-emerald-500" : "bg-muted-foreground/30"
                }`}
              />
              <Avatar seed={m.avatarSeed} size={28} className="shrink-0" />
              <span
                className={`flex-1 text-sm font-medium truncate ${
                  isSkipped ? "line-through text-muted-foreground" : ""
                }`}
              >
                {m.displayName}
              </span>
              {isAnnouncer ? (
                <span
                  className="text-xs font-semibold text-primary"
                  aria-label="Current announcer"
                >
                  🎤 announcing
                </span>
              ) : null}
              {isDelegate ? (
                <span
                  className="text-xs font-semibold text-accent"
                  aria-label="Active delegate"
                >
                  🛂 delegate
                </span>
              ) : null}
              {isSkipped ? (
                <span
                  className="text-xs font-medium text-muted-foreground"
                  aria-label="Skipped"
                >
                  skipped
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
