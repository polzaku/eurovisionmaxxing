"use client";

import { useEffect, useState } from "react";
import Avatar from "@/components/ui/Avatar";
import Button from "@/components/ui/Button";
import QrCode from "@/components/ui/QrCode";
import CategoriesPreview from "@/components/room/CategoriesPreview";
import RefreshContestantsButton, {
  type RefreshDiff,
} from "@/components/room/RefreshContestantsButton";

export interface LobbyMember {
  userId: string;
  displayName: string;
  avatarSeed: string;
}

export interface LobbyCategory {
  name: string;
  hint?: string;
}

export type StartVotingState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "error"; message: string };

interface LobbyViewProps {
  pin: string;
  ownerUserId: string;
  memberships: LobbyMember[];
  categories: LobbyCategory[];
  isAdmin: boolean;
  startVotingState: StartVotingState;
  shareUrl: string;
  onStartVoting: () => void;
  onCopyPin: () => void;
  onCopyLink: () => void;
  /**
   * Optional admin-only contestant refresh. When provided, renders the
   * SPEC §5.1d "Refresh contestants" button + status line. Called by the
   * room page wrapping `refreshContestantsApi` + `contestantDiff`.
   */
  onRefreshContestants?: () => Promise<RefreshDiff | null>;
  /**
   * SPEC §6.1 / A2 — owner-only inline switch of announcement_mode while
   * the room is still in the lobby. When provided alongside `announcementMode`
   * + `isAdmin`, renders a two-button toggle (Live / Instant). Year + event
   * remain immutable; categories edits deferred to V1.1.
   */
  announcementMode?: "live" | "instant";
  onChangeAnnouncementMode?: (mode: "live" | "instant") => Promise<void>;
}

function useCopiedFlag(): [boolean, () => void] {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);
  return [copied, () => setCopied(true)];
}

export default function LobbyView({
  pin,
  ownerUserId,
  memberships,
  categories,
  isAdmin,
  startVotingState,
  shareUrl,
  onStartVoting,
  onCopyPin,
  onCopyLink,
  onRefreshContestants,
  announcementMode,
  onChangeAnnouncementMode,
}: LobbyViewProps) {
  const [pinCopied, markPinCopied] = useCopiedFlag();
  const [linkCopied, markLinkCopied] = useCopiedFlag();
  const [modeBusy, setModeBusy] = useState(false);

  const handleModeChange = async (next: "live" | "instant") => {
    if (modeBusy) return;
    if (!onChangeAnnouncementMode) return;
    if (next === announcementMode) return;
    setModeBusy(true);
    try {
      await onChangeAnnouncementMode(next);
    } finally {
      setModeBusy(false);
    }
  };

  const showModeToggle =
    isAdmin && !!announcementMode && !!onChangeAnnouncementMode;

  return (
    <main className="flex min-h-screen flex-col items-center px-6 py-12">
      <div className="max-w-md w-full space-y-8 animate-fade-in">
        {isAdmin && (
          <section className="text-center space-y-1">
            <p className="text-xs uppercase tracking-widest text-primary">
              Host lobby
            </p>
            <h1 className="text-2xl font-bold">You&rsquo;re the host</h1>
            <p className="text-sm text-muted-foreground">
              Share the PIN or QR with your guests, then start voting once
              everyone&rsquo;s in.
            </p>
          </section>
        )}

        <section className="text-center space-y-2">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            Room PIN
          </p>
          <div className="flex items-center justify-center gap-3">
            <span className="text-4xl font-mono font-bold tracking-[0.5em]">
              {pin}
            </span>
            <button
              type="button"
              onClick={() => {
                onCopyPin();
                markPinCopied();
              }}
              aria-label="Copy PIN"
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              {pinCopied ? "Copied!" : "Copy"}
            </button>
          </div>
        </section>

        {isAdmin && (
          <>
            <section className="flex flex-col items-center gap-2">
              <QrCode url={shareUrl} size={256} alt="Scan to join this room" />
              <p className="text-xs text-muted-foreground">Scan to join</p>
            </section>

            <section className="space-y-2">
              <p className="text-xs uppercase tracking-widest text-muted-foreground">
                Share link
              </p>
              <div className="flex items-center gap-2 rounded-lg border-2 border-border bg-card px-3 py-2">
                <input
                  type="text"
                  readOnly
                  value={shareUrl}
                  className="flex-1 bg-transparent text-sm font-mono outline-none"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <button
                  type="button"
                  onClick={() => {
                    onCopyLink();
                    markLinkCopied();
                  }}
                  aria-label="Copy share link"
                  className="text-sm text-muted-foreground hover:text-foreground"
                >
                  {linkCopied ? "Copied!" : "Copy"}
                </button>
              </div>
            </section>
          </>
        )}

        <CategoriesPreview categories={categories} />

        {isAdmin && onRefreshContestants ? (
          <section className="space-y-1">
            <RefreshContestantsButton onRefresh={onRefreshContestants} />
          </section>
        ) : null}

        {showModeToggle ? (
          <section
            className="space-y-2"
            data-testid="lobby-announcement-mode-toggle"
          >
            <p className="text-xs uppercase tracking-widest text-muted-foreground">
              Announcement mode
            </p>
            <div className="grid grid-cols-2 gap-2">
              {(["live", "instant"] as const).map((m) => {
                const selected = m === announcementMode;
                const label = m === "live" ? "Live" : "Instant";
                return (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={selected}
                    disabled={modeBusy || selected}
                    onClick={() => void handleModeChange(m)}
                    className={`rounded-lg border-2 px-4 py-2 text-sm font-medium transition-all ${
                      selected
                        ? "border-primary bg-primary/10 text-primary cursor-default"
                        : "border-border hover:border-accent disabled:opacity-50"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              Switch any time before voting starts. Year and event are locked.
            </p>
          </section>
        ) : null}

        <section className="space-y-3">
          <h2 className="text-sm uppercase tracking-wider text-muted-foreground">
            Who&rsquo;s here ({memberships.length})
          </h2>
          <div className="grid grid-cols-3 gap-4">
            {memberships.map((m) => (
              <div
                key={m.userId}
                className="flex flex-col items-center text-center space-y-1"
              >
                <Avatar seed={m.avatarSeed} size={64} />
                <p className="text-sm font-medium truncate w-full">
                  {m.displayName}
                  {m.userId === ownerUserId && (
                    <span className="ml-1 text-xs text-primary">★</span>
                  )}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          {isAdmin ? (
            <>
              <Button
                onClick={onStartVoting}
                disabled={startVotingState.kind === "submitting"}
                className="w-full"
              >
                {startVotingState.kind === "submitting"
                  ? "Starting…"
                  : "Start voting"}
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                Starts voting for everyone in the room — wait until your guests
                are here.
              </p>
              {startVotingState.kind === "error" && (
                <p role="alert" className="text-sm text-destructive text-center">
                  {startVotingState.message}
                </p>
              )}
            </>
          ) : (
            <p className="text-center text-muted-foreground text-sm">
              Waiting for the host to start voting&hellip;
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
