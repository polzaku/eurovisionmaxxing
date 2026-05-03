"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

interface EndOfShowCtasProps {
  isAdmin: boolean;
  shareUrl: string;
  textSummary: string;
  year: number;
  event: string;
}

const COPY_CONFIRM_MS = 2000;

/**
 * SPEC §11.3 post-awards 3-CTA footer. Guests see Copy share link + Copy
 * text summary. Admins additionally see Create another room (routes to
 * /create with year + event prefilled). Each clipboard CTA flips to a
 * 2-s "copied!" confirmation state on success.
 */
export default function EndOfShowCtas({
  isAdmin,
  shareUrl,
  textSummary,
  year,
  event,
}: EndOfShowCtasProps) {
  const t = useTranslations();
  const router = useRouter();
  const [linkCopied, setLinkCopied] = useState(false);
  const [summaryCopied, setSummaryCopied] = useState(false);
  const linkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const summaryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (linkTimerRef.current) clearTimeout(linkTimerRef.current);
      if (summaryTimerRef.current) clearTimeout(summaryTimerRef.current);
    },
    [],
  );

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard?.writeText(shareUrl);
      setLinkCopied(true);
      if (linkTimerRef.current) clearTimeout(linkTimerRef.current);
      linkTimerRef.current = setTimeout(
        () => setLinkCopied(false),
        COPY_CONFIRM_MS,
      );
    } catch {
      /* swallow — best-effort clipboard */
    }
  }, [shareUrl]);

  const copySummary = useCallback(async () => {
    try {
      await navigator.clipboard?.writeText(textSummary);
      setSummaryCopied(true);
      if (summaryTimerRef.current) clearTimeout(summaryTimerRef.current);
      summaryTimerRef.current = setTimeout(
        () => setSummaryCopied(false),
        COPY_CONFIRM_MS,
      );
    } catch {
      /* swallow */
    }
  }, [textSummary]);

  const createAnother = useCallback(() => {
    router.push(
      `/create?year=${encodeURIComponent(year)}&event=${encodeURIComponent(event)}`,
    );
  }, [router, year, event]);

  return (
    <div className="flex w-full max-w-md flex-col gap-3 sm:flex-row">
      <button
        type="button"
        onClick={copyLink}
        className="flex-1 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition-transform hover:scale-[1.02] active:scale-[0.98]"
      >
        {linkCopied
          ? t("awards.endOfShow.copyLinkConfirm")
          : t("awards.endOfShow.copyLink")}
      </button>
      <button
        type="button"
        onClick={copySummary}
        className="flex-1 rounded-xl border-2 border-border px-4 py-3 text-sm font-semibold transition-transform hover:scale-[1.02] active:scale-[0.98]"
      >
        {summaryCopied
          ? t("awards.endOfShow.copySummaryConfirm")
          : t("awards.endOfShow.copySummary")}
      </button>
      {isAdmin ? (
        <button
          type="button"
          onClick={createAnother}
          className="flex-1 rounded-xl border-2 border-border px-4 py-3 text-sm font-semibold transition-transform hover:scale-[1.02] active:scale-[0.98]"
        >
          {t("awards.endOfShow.createAnother")}
        </button>
      ) : null}
    </div>
  );
}
