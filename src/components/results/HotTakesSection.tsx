"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { getSession } from "@/lib/session";
import { deleteHotTakeApi } from "@/lib/voting/deleteHotTakeApi";
import type { Contestant } from "@/types";

export interface HotTakeRow {
  userId: string;
  displayName: string;
  avatarSeed: string;
  contestantId: string;
  hotTake: string;
  /** SPEC §8.7.1 — non-null indicates the hot-take was edited after first save. */
  hotTakeEditedAt: string | null;
}

interface HotTakesSectionProps {
  title: string;
  /** Locale-resolved label for the inline `(edited)` tag. */
  editedLabel: string;
  hotTakes: HotTakeRow[];
  contestants: Contestant[];
  /** Room id — needed for the DELETE endpoint when admin moderates. */
  roomId: string;
  /** Room owner — clients with a matching session unlock the trash icon. */
  ownerUserId: string;
}

interface DeleteTarget {
  userId: string;
  contestantId: string;
  displayName: string;
}

/**
 * SPEC §8.7.2 — admin moderation surface on the read-only results page.
 *
 * Public read-only page; auth happens client-side. We compare the
 * viewer's session userId (from localStorage) against `ownerUserId`
 * (passed in from the server-rendered page); only matching viewers
 * see the trash icon. The actual auth check is server-enforced in
 * `deleteHotTake.ts` via owner_user_id === userId, so the client gate
 * is convenience-only — a tampered client can't actually delete.
 *
 * Optimistic UI: on confirm, the row is removed from local state
 * immediately. If the API call fails, we restore it and surface an
 * inline error inside the modal (rare — admin moderation isn't
 * latency-sensitive).
 */
export default function HotTakesSection({
  title,
  editedLabel,
  hotTakes,
  contestants,
  roomId,
  ownerUserId,
}: HotTakesSectionProps) {
  const t = useTranslations();

  const lookup = useMemo(
    () => new Map<string, Contestant>(contestants.map((c) => [c.id, c])),
    [contestants],
  );

  // Whose session is viewing this page? Only owners get the admin UI.
  // Read in useEffect to avoid SSR mismatch (localStorage is client-only).
  const [viewerUserId, setViewerUserId] = useState<string | null>(null);
  useEffect(() => {
    setViewerUserId(getSession()?.userId ?? null);
  }, []);
  const isOwner = viewerUserId !== null && viewerUserId === ownerUserId;

  // Optimistic deletion: track which (userId, contestantId) pairs have
  // been removed locally so they disappear from the list immediately.
  const [deletedKeys, setDeletedKeys] = useState<Set<string>>(new Set());
  const keyOf = (h: { userId: string; contestantId: string }) =>
    `${h.userId}\u0000${h.contestantId}`;

  const visibleHotTakes = useMemo(
    () => hotTakes.filter((h) => !deletedKeys.has(keyOf(h))),
    [hotTakes, deletedKeys],
  );

  // Group by country for a tidier render — same structure as the
  // server-side <HotTakes> it replaces.
  const byCountry = useMemo(() => {
    const m = new Map<string, HotTakeRow[]>();
    for (const h of visibleHotTakes) {
      const list = m.get(h.contestantId) ?? [];
      list.push(h);
      m.set(h.contestantId, list);
    }
    return m;
  }, [visibleHotTakes]);

  const [confirmTarget, setConfirmTarget] = useState<DeleteTarget | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestDelete = (h: HotTakeRow) => {
    setError(null);
    setConfirmTarget({
      userId: h.userId,
      contestantId: h.contestantId,
      displayName: h.displayName,
    });
  };

  const cancelDelete = () => {
    if (submitting) return;
    setConfirmTarget(null);
    setError(null);
  };

  const performDelete = async () => {
    if (!confirmTarget || !viewerUserId) return;
    setSubmitting(true);
    setError(null);
    const result = await deleteHotTakeApi(
      {
        roomId,
        userId: viewerUserId,
        targetUserId: confirmTarget.userId,
        contestantId: confirmTarget.contestantId,
      },
      { fetch: window.fetch.bind(window) },
    );
    setSubmitting(false);
    if (result.ok) {
      setDeletedKeys((prev) => {
        const next = new Set(prev);
        next.add(keyOf(confirmTarget));
        return next;
      });
      setConfirmTarget(null);
    } else {
      setError(t("results.hotTake.deleteError"));
    }
  };

  if (visibleHotTakes.length === 0) return null;

  return (
    <section className="space-y-3" data-testid="hot-takes-section">
      <h2 className="text-xl font-semibold">{title}</h2>
      <div className="space-y-4">
        {[...byCountry.entries()].map(([contestantId, takes]) => {
          const c = lookup.get(contestantId);
          return (
            <div key={contestantId} className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span aria-hidden>{c?.flagEmoji ?? "🏳️"}</span>
                <span>{c?.country ?? contestantId}</span>
              </div>
              <ul className="space-y-2">
                {takes.map((h, i) => (
                  <li
                    key={`${h.userId}-${i}`}
                    data-testid={`hot-take-${h.userId}-${h.contestantId}`}
                    className="rounded-xl border border-border px-4 py-3"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-sm text-muted-foreground mb-1">
                        {h.displayName}
                      </p>
                      {isOwner ? (
                        <button
                          type="button"
                          onClick={() => requestDelete(h)}
                          aria-label={t("results.hotTake.deleteAria", {
                            name: h.displayName,
                          })}
                          className="text-sm text-muted-foreground hover:text-destructive transition-colors"
                          data-testid={`hot-take-delete-${h.userId}-${h.contestantId}`}
                        >
                          🗑
                        </button>
                      ) : null}
                    </div>
                    <p>
                      {h.hotTake}
                      {h.hotTakeEditedAt ? (
                        <>
                          {" "}
                          <span
                            data-testid="hot-take-edited-tag"
                            className="text-xs uppercase tracking-wider text-muted-foreground"
                          >
                            {editedLabel}
                          </span>
                        </>
                      ) : null}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      {confirmTarget ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t("results.hotTake.deleteConfirmTitle")}
          data-testid="hot-take-delete-confirm"
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 px-4"
          onClick={cancelDelete}
        >
          <div
            className="max-w-sm w-full rounded-2xl border border-border bg-card px-6 py-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold">
              {t("results.hotTake.deleteConfirmTitle")}
            </h3>
            <p className="text-sm text-muted-foreground">
              {t("results.hotTake.deleteConfirmBody", {
                name: confirmTarget.displayName,
              })}
            </p>
            {error ? (
              <p
                role="alert"
                className="text-sm text-destructive"
                data-testid="hot-take-delete-error"
              >
                {error}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={cancelDelete}
                disabled={submitting}
                className="rounded-lg border-2 border-border px-3 py-2 text-sm font-medium disabled:opacity-60"
              >
                {t("results.hotTake.deleteCancel")}
              </button>
              <button
                type="button"
                onClick={performDelete}
                disabled={submitting}
                className="rounded-lg bg-destructive px-3 py-2 text-sm font-semibold text-destructive-foreground disabled:opacity-60"
                data-testid="hot-take-delete-confirm-action"
              >
                {submitting
                  ? t("results.hotTake.deleteSubmitting")
                  : t("results.hotTake.deleteConfirmAction")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
