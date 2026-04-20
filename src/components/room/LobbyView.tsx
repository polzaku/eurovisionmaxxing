"use client";

import Avatar from "@/components/ui/Avatar";
import Button from "@/components/ui/Button";

export interface LobbyMember {
  userId: string;
  displayName: string;
  avatarSeed: string;
}

export type StartVotingState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "error"; message: string };

interface LobbyViewProps {
  pin: string;
  ownerUserId: string;
  memberships: LobbyMember[];
  isAdmin: boolean;
  startVotingState: StartVotingState;
  onStartVoting: () => void;
  onCopyPin: () => void;
}

export default function LobbyView({
  pin,
  ownerUserId,
  memberships,
  isAdmin,
  startVotingState,
  onStartVoting,
  onCopyPin,
}: LobbyViewProps) {
  return (
    <main className="flex min-h-screen flex-col items-center px-6 py-12">
      <div className="max-w-md w-full space-y-8 animate-fade-in">
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
              onClick={onCopyPin}
              aria-label="Copy PIN"
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Copy
            </button>
          </div>
        </section>

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
              {startVotingState.kind === "error" && (
                <p role="alert" className="text-sm text-destructive text-center">
                  {startVotingState.message}
                </p>
              )}
            </>
          ) : (
            <p className="text-center text-muted-foreground text-sm">
              Waiting for the host to start voting…
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
