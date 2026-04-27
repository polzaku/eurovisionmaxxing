export type RevealCtaAnywayLabel =
  | { kind: "halfReady"; readyCount: number; totalCount: number }
  | { kind: "countdown"; secondsRemaining: number }
  | { kind: "disabled" };

export interface RevealCtaState {
  canRevealAll: boolean;
  canRevealAnyway: boolean;
  anywayLabel: RevealCtaAnywayLabel;
}

export interface NextRevealCtaStateInput {
  readyCount: number;
  totalCount: number;
  firstReadyAt: number | null;
  now: number;
}

const COUNTDOWN_MS = 60_000;

export function nextRevealCtaState(
  input: NextRevealCtaStateInput,
): RevealCtaState {
  const { readyCount, totalCount, firstReadyAt, now } = input;

  const canRevealAll = totalCount > 0 && readyCount === totalCount;

  if (firstReadyAt === null || totalCount === 0) {
    return {
      canRevealAll,
      canRevealAnyway: false,
      anywayLabel: { kind: "disabled" },
    };
  }

  const halfReached = readyCount * 2 >= totalCount;
  if (halfReached) {
    return {
      canRevealAll,
      canRevealAnyway: true,
      anywayLabel: { kind: "halfReady", readyCount, totalCount },
    };
  }

  const elapsed = now - firstReadyAt;
  const secondsRemaining = Math.max(
    0,
    Math.ceil((COUNTDOWN_MS - elapsed) / 1000),
  );
  return {
    canRevealAll,
    canRevealAnyway: elapsed >= COUNTDOWN_MS,
    anywayLabel: { kind: "countdown", secondsRemaining },
  };
}
