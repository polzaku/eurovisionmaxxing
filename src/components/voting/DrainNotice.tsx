"use client";

import { useState } from "react";
import type { DrainNotice as DrainNoticePayload } from "@/lib/voting/OfflineAdapter";

export interface DrainNoticeProps {
  notice: DrainNoticePayload | null;
  onDismiss: () => void;
}

/**
 * Inline notice surfaced after an offline drain completes with skipped
 * entries (server-newer conflict) or a roomId where voting ended
 * mid-drain. SPEC §8.5.1 + §8.5.2.
 *
 * Style mirrors OfflineBanner (sticky-top, rounded, accent-pink) plus a
 * × dismiss button and an inline expand-for-details for the skipped case.
 */
export default function DrainNotice({ notice, onDismiss }: DrainNoticeProps) {
  const [expanded, setExpanded] = useState(false);
  if (!notice) return null;

  const skippedCount = notice.skipped.length;
  const endedCount = notice.votingEndedRoomIds.length;

  if (endedCount > 0) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="sticky top-2 mx-4 z-10 rounded-lg border border-accent/30 bg-accent/10 text-accent text-center px-4 py-2 text-sm font-medium backdrop-blur-sm flex items-center justify-between gap-2"
      >
        <span>
          Voting ended while you were offline — your unsaved changes for this
          room were discarded.
        </span>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          className="flex-shrink-0 px-1 text-accent/80 hover:text-accent"
        >
          ×
        </button>
      </div>
    );
  }

  if (skippedCount === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky top-2 mx-4 z-10 rounded-lg border border-accent/30 bg-accent/10 text-accent px-4 py-2 text-sm font-medium backdrop-blur-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="flex-1">
          {skippedCount} offline edit{skippedCount === 1 ? "" : "s"} couldn&rsquo;t
          be applied (newer values on the server).
          {!expanded && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="ml-2 underline"
            >
              View
            </button>
          )}
        </span>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          className="flex-shrink-0 px-1 text-accent/80 hover:text-accent"
        >
          ×
        </button>
      </div>
      {expanded && (
        <ul className="mt-2 list-disc pl-5 text-xs">
          {notice.skipped.map((s) => (
            <li key={s.entry.id}>
              {s.entry.payload.contestantId}
              {s.entry.payload.scores &&
              Object.keys(s.entry.payload.scores).length > 0
                ? ` (${Object.keys(s.entry.payload.scores).join(", ")})`
                : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
