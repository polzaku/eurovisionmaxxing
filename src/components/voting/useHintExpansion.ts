import { useEffect, useMemo, useReducer, useCallback } from "react";
import { isSeen, markSeen } from "@/lib/voting/emxHintsSeen";

export type HintExpansionState = {
  contestantId: string;
  onboarding: boolean;
  overrides: Record<string, boolean>;
};

export type HintExpansionEvent =
  | { type: "init"; roomSeen: boolean; contestantId: string }
  | { type: "contestantChanged"; contestantId: string }
  | { type: "toggle"; name: string }
  | { type: "scored" }
  | { type: "navigated" };

export function nextHintExpansion(
  state: HintExpansionState,
  event: HintExpansionEvent,
): HintExpansionState {
  switch (event.type) {
    case "init":
      return {
        contestantId: event.contestantId,
        onboarding: !event.roomSeen,
        overrides: {},
      };
    case "contestantChanged":
      if (event.contestantId === state.contestantId) return state;
      return {
        contestantId: event.contestantId,
        onboarding: state.onboarding,
        overrides: {},
      };
    case "toggle": {
      const currentEffective =
        state.overrides[event.name] ?? state.onboarding;
      return {
        contestantId: state.contestantId,
        onboarding: false,
        overrides: { ...state.overrides, [event.name]: !currentEffective },
      };
    }
    case "scored":
    case "navigated":
      if (!state.onboarding) return state;
      return { ...state, onboarding: false };
  }
}

export interface UseHintExpansionResult {
  expandedFor: Record<string, boolean>;
  toggleFor: (name: string) => void;
  onScored: () => void;
  onNavigated: () => void;
  onboarding: boolean;
}

export function useHintExpansion(
  roomId: string | undefined,
  contestantId: string,
  categoryNames: readonly string[],
): UseHintExpansionResult {
  const [state, dispatch] = useReducer(
    nextHintExpansion,
    { contestantId, roomId },
    (init) =>
      nextHintExpansion({} as HintExpansionState, {
        type: "init",
        roomSeen: init.roomId ? isSeen(init.roomId) : true,
        contestantId: init.contestantId,
      }),
  );

  useEffect(() => {
    dispatch({ type: "contestantChanged", contestantId });
  }, [contestantId]);

  useEffect(() => {
    if (!state.onboarding && roomId) {
      markSeen(roomId);
    }
  }, [state.onboarding, roomId]);

  const expandedFor = useMemo(() => {
    const result: Record<string, boolean> = {};
    for (const name of categoryNames) {
      result[name] = state.overrides[name] ?? state.onboarding;
    }
    return result;
  }, [categoryNames, state.overrides, state.onboarding]);

  const toggleFor = useCallback(
    (name: string) => dispatch({ type: "toggle", name }),
    [],
  );

  const onScored = useCallback(() => dispatch({ type: "scored" }), []);
  const onNavigated = useCallback(() => dispatch({ type: "navigated" }), []);

  return {
    expandedFor,
    toggleFor,
    onScored,
    onNavigated,
    onboarding: state.onboarding,
  };
}
