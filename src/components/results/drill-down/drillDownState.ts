/**
 * SPEC §12.6 — page-level state machine for the three drill-down sheets.
 *
 * Only one sheet is open at any time. The triple union encodes which
 * surface is open; `null` is closed. Trigger components dispatch `open`
 * with a payload; the close button / ESC / backdrop dispatch `close`.
 */
export type DrillDownOpen =
  | { kind: "contestant"; contestantId: string }
  | { kind: "participant"; userId: string }
  | { kind: "category"; categoryKey: string };

export type DrillDownState = DrillDownOpen | null;

export type DrillDownAction =
  | { type: "open"; payload: DrillDownOpen }
  | { type: "close" };

export function drillDownReducer(
  state: DrillDownState,
  action: DrillDownAction,
): DrillDownState {
  switch (action.type) {
    case "open":
      return action.payload;
    case "close":
      return null;
  }
}
