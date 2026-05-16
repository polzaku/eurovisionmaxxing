"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import Avatar from "@/components/ui/Avatar";
import { useRoomPresence } from "@/hooks/useRoomPresence";
import Button from "@/components/ui/Button";
import QrCode from "@/components/ui/QrCode";
import CategoriesPreview from "@/components/room/CategoriesPreview";
import LobbyCountdown from "@/components/room/LobbyCountdown";
import RefreshContestantsButton, {
  type RefreshDiff,
} from "@/components/room/RefreshContestantsButton";
import { VOTING_TEMPLATES } from "@/lib/templates";
import type { Contestant } from "@/types";
import ContestantPrimerCarousel from "@/components/room/ContestantPrimerCarousel";
import AnnouncementStyleSubRadio from "@/components/create/AnnouncementStyleSubRadio";

const PREDEFINED_TEMPLATES = VOTING_TEMPLATES.filter((t) => t.id !== "custom");

function categoryNameSet(cats: { name: string }[]): Set<string> {
  return new Set(cats.map((c) => c.name.toLowerCase()));
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

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
   * remain immutable.
   */
  announcementMode?: "live" | "instant";
  onChangeAnnouncementMode?: (mode: "live" | "instant") => Promise<void>;
  /** Current style. Required-ish when announcementMode='live'; ignored otherwise. */
  announcementStyle?: "full" | "short";
  /** Owner-only lobby-edit callback. Promise so the UI can show busy state. */
  onChangeAnnouncementStyle?: (next: "full" | "short") => Promise<void>;
  /**
   * SPEC §6.1 / A2 — owner-only template picker for swapping the room's
   * categories array while still in the lobby. When provided, renders a
   * row of predefined template buttons (Classic / Spectacle / Banger Test).
   * Currently-selected template is detected via name-set comparison and
   * is rendered disabled + highlighted. Custom builder UI is V1.1.
   */
  onChangeCategories?: (
    categories: { name: string; weight: number; hint?: string }[],
  ) => Promise<void>;
  /** SPEC §6.6.2 — required for the live presence channel subscription. */
  roomId: string;
  currentUserId: string;
  /**
   * SPEC §6.6.1 — when null, <LobbyCountdown> renders the
   * "Ready whenever you are." fallback. When a valid ISO 8601 UTC
   * timestamp, the countdown ticks down to that target.
   */
  broadcastStartUtc?: string | null;
  /** SPEC §6.6.3 — surfaced via the contestant primer carousel.
   * Empty array suppresses the carousel section. */
  contestants: Contestant[];
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
  announcementStyle,
  onChangeAnnouncementStyle,
  onChangeCategories,
  roomId,
  currentUserId,
  broadcastStartUtc,
  contestants,
}: LobbyViewProps) {
  const t = useTranslations();
  const [pinCopied, markPinCopied] = useCopiedFlag();
  const [linkCopied, markLinkCopied] = useCopiedFlag();
  const [modeBusy, setModeBusy] = useState(false);
  const [styleBusy, setStyleBusy] = useState(false);
  const [templateBusy, setTemplateBusy] = useState(false);

  const presenceUserIds = useRoomPresence(roomId, currentUserId);

  const hostDisplayName = useMemo(
    () =>
      memberships.find((m) => m.userId === ownerUserId)?.displayName ?? null,
    [memberships, ownerUserId],
  );

  const currentNameSet = useMemo(
    () => categoryNameSet(categories),
    [categories],
  );

  const selectedTemplateId = useMemo(() => {
    for (const tpl of PREDEFINED_TEMPLATES) {
      if (setsEqual(categoryNameSet(tpl.categories), currentNameSet)) {
        return tpl.id;
      }
    }
    return null;
  }, [currentNameSet]);

  const handleTemplateChange = async (templateId: string) => {
    if (templateBusy) return;
    if (!onChangeCategories) return;
    if (templateId === selectedTemplateId) return;
    const tpl = PREDEFINED_TEMPLATES.find((t) => t.id === templateId);
    if (!tpl) return;
    setTemplateBusy(true);
    try {
      await onChangeCategories(
        tpl.categories.map((c) => ({
          name: c.name,
          weight: c.weight,
          ...(c.hint ? { hint: c.hint } : {}),
        })),
      );
    } finally {
      setTemplateBusy(false);
    }
  };

  const showTemplatePicker = isAdmin && !!onChangeCategories;

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

  const handleStyleChange = async (next: "full" | "short") => {
    if (styleBusy) return;
    if (!onChangeAnnouncementStyle) return;
    if (next === announcementStyle) return;
    setStyleBusy(true);
    try {
      await onChangeAnnouncementStyle(next);
    } finally {
      setStyleBusy(false);
    }
  };

  const showStyleToggle =
    isAdmin &&
    announcementMode === "live" &&
    !!announcementStyle &&
    !!onChangeAnnouncementStyle;

  return (
    <main className="flex min-h-screen flex-col items-center px-6 py-12">
      <div className="max-w-md w-full space-y-8 animate-fade-in">
        {isAdmin && (
          <section className="text-center space-y-1">
            <p className="text-xs uppercase tracking-widest text-primary">
              {t("lobby.hostEyebrow")}
            </p>
            <h1 className="text-2xl font-bold">{t("lobby.hostHeading")}</h1>
            <p className="text-sm text-muted-foreground">
              {t("lobby.hostSubheading")}
            </p>
          </section>
        )}

        {isAdmin && announcementStyle === "short" ? (
          <section
            data-testid="lobby-short-info-card"
            className="rounded-2xl border-2 border-accent bg-accent/5 px-4 py-3 space-y-1"
          >
            <p className="text-sm font-semibold">
              {t("announcementStyle.short.lobbyCard.title")}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("announcementStyle.short.lobbyCard.body")}
            </p>
          </section>
        ) : null}

        <section className="text-center space-y-2">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            {t("lobby.roomPinLabel")}
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
              aria-label={t("lobby.roomPinLabel")}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              {pinCopied ? t("lobby.pinCopied") : t("lobby.copyPin")}
            </button>
          </div>
        </section>

        {isAdmin && (
          <>
            <section className="flex flex-col items-center gap-2">
              <QrCode url={shareUrl} size={256} alt={t("lobby.scanToJoin")} />
              <p className="text-xs text-muted-foreground">{t("lobby.scanToJoin")}</p>
            </section>

            <section className="space-y-2">
              <p className="text-xs uppercase tracking-widest text-muted-foreground">
                {t("lobby.shareLinkLabel")}
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
                  aria-label={t("lobby.shareLinkLabel")}
                  className="text-sm text-muted-foreground hover:text-foreground"
                >
                  {linkCopied ? t("lobby.linkCopied") : t("lobby.copyLink")}
                </button>
              </div>
            </section>

            <section className="space-y-1">
              <a
                href={`${shareUrl}/present`}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="lobby-present-link"
                className="block w-full rounded-lg border-2 border-border bg-card px-4 py-3 text-center text-sm font-medium hover:border-accent hover:bg-card/80 transition-colors"
              >
                <span aria-hidden className="mr-2">📺</span>
                {t("lobby.openPresentView")}
              </a>
              <p className="text-xs text-muted-foreground text-center">
                {t("lobby.openPresentSubtext")}
              </p>
            </section>
          </>
        )}

        <CategoriesPreview categories={categories} />

        {isAdmin && onRefreshContestants ? (
          <section className="space-y-1">
            <RefreshContestantsButton onRefresh={onRefreshContestants} />
          </section>
        ) : null}

        {showTemplatePicker ? (
          <section
            className="space-y-2"
            data-testid="lobby-template-picker"
          >
            <p className="text-xs uppercase tracking-widest text-muted-foreground">
              {t("lobby.votingTemplateLabel")}
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {PREDEFINED_TEMPLATES.map((tpl) => {
                const selected = tpl.id === selectedTemplateId;
                return (
                  <button
                    key={tpl.id}
                    type="button"
                    aria-pressed={selected}
                    disabled={templateBusy || selected}
                    onClick={() => void handleTemplateChange(tpl.id)}
                    className={`rounded-lg border-2 px-3 py-2 text-left text-sm transition-all ${
                      selected
                        ? "border-primary bg-primary/10 cursor-default"
                        : "border-border hover:border-accent disabled:opacity-50"
                    }`}
                  >
                    <span className="block font-medium">{tpl.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {t("lobby.templateCategoryCount", { count: tpl.categories.length })}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              {selectedTemplateId === null
                ? t("lobby.templateCustomNote")
                : t("lobby.templateSwitchNote")}
            </p>
          </section>
        ) : null}

        {showModeToggle ? (
          <section
            className="space-y-2"
            data-testid="lobby-announcement-mode-toggle"
          >
            <p className="text-xs uppercase tracking-widest text-muted-foreground">
              {t("lobby.announcementModeLabel")}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {(["live", "instant"] as const).map((m) => {
                const selected = m === announcementMode;
                const label = m === "live" ? t("lobby.modeLive") : t("lobby.modeInstant");
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
              {t("lobby.modeSwitchNote")}
            </p>
          </section>
        ) : null}

        {showStyleToggle ? (
          <section
            className="space-y-2"
            data-testid="lobby-announcement-style-toggle"
          >
            <AnnouncementStyleSubRadio
              value={announcementStyle as "full" | "short"}
              onChange={(next) => void handleStyleChange(next)}
              disabled={styleBusy}
            />
          </section>
        ) : null}

        <section className="space-y-3">
          <LobbyCountdown broadcastStartUtc={broadcastStartUtc ?? null} />
        </section>

        <section className="space-y-3">
          <h2 className="text-sm uppercase tracking-wider text-muted-foreground">
            {t("lobby.whoIsHere", { count: memberships.length })}
          </h2>
          <div className="grid grid-cols-3 gap-4">
            {memberships.map((m) => {
              const isOnline = presenceUserIds.has(m.userId);
              return (
                <div
                  key={m.userId}
                  data-testid={`lobby-member-${m.userId}`}
                  data-online={isOnline ? "true" : "false"}
                  className={`flex flex-col items-center text-center space-y-1 transition-opacity ${
                    isOnline ? "" : "opacity-50"
                  }`}
                >
                  <div className="relative">
                    <Avatar seed={m.avatarSeed} size={64} />
                    <span
                      aria-hidden
                      title={isOnline ? t("lobby.presenceOnline") : t("lobby.presenceOffline")}
                      className={`absolute bottom-0 right-0 inline-block w-3 h-3 rounded-full border-2 border-card ${
                        isOnline ? "bg-emerald-500" : "bg-muted-foreground/40"
                      }`}
                    />
                  </div>
                  <p className="text-sm font-medium truncate w-full">
                    {m.displayName}
                    {m.userId === ownerUserId && (
                      <span className="ml-1 text-xs text-primary">★</span>
                    )}
                  </p>
                </div>
              );
            })}
          </div>
        </section>

        <section className="space-y-3">
          <ContestantPrimerCarousel
            contestants={contestants}
            categories={categories}
            roomId={roomId}
          />
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
                  ? t("lobby.startVotingBusy")
                  : t("lobby.startVoting")}
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                {t("lobby.startVotingHelper")}
              </p>
              {startVotingState.kind === "error" && (
                <p role="alert" className="text-sm text-destructive text-center">
                  {startVotingState.message}
                </p>
              )}
            </>
          ) : (
            <p className="text-center text-muted-foreground text-sm">
              {hostDisplayName !== null
                ? t("lobby.waitingForHostNamed", { name: hostDisplayName })
                : t("lobby.waitingForHost")}
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
