"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  MissedUndoController,
  type MissedUndoToast,
} from "@/lib/voting/MissedUndoController";

export interface UseMissedUndoParams {
  onUndo: (contestantId: string) => void;
  ttlMs?: number;
}

export interface UseMissedUndoResult {
  toast: MissedUndoToast | null;
  trigger: (contestantId: string, projectedOverall: number) => void;
  undo: () => void;
  dismiss: () => void;
}

export function useMissedUndo(
  params: UseMissedUndoParams
): UseMissedUndoResult {
  const [toast, setToast] = useState<MissedUndoToast | null>(null);
  const ctrlRef = useRef<MissedUndoController | null>(null);

  useEffect(() => {
    const ctrl = new MissedUndoController({
      onUndo: params.onUndo,
      onChange: setToast,
      ttlMs: params.ttlMs,
    });
    ctrlRef.current = ctrl;
    return () => {
      ctrl.dispose();
      if (ctrlRef.current === ctrl) ctrlRef.current = null;
    };
  }, [params.onUndo, params.ttlMs]);

  const trigger = useCallback(
    (contestantId: string, projectedOverall: number) => {
      ctrlRef.current?.trigger(contestantId, projectedOverall);
    },
    []
  );

  const undo = useCallback(() => {
    ctrlRef.current?.undo();
  }, []);

  const dismiss = useCallback(() => {
    ctrlRef.current?.dismiss();
  }, []);

  return { toast, trigger, undo, dismiss };
}
