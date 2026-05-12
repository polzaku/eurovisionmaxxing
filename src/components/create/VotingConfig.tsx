"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import Button from "@/components/ui/Button";
import { VOTING_TEMPLATES } from "@/lib/templates";
import TemplateCard from "./TemplateCard";
import AnnouncementModeCard from "./AnnouncementModeCard";
import AnnouncementStyleSubRadio from "./AnnouncementStyleSubRadio";
import { nextExpandedId } from "./expandedId";

type TemplateId = "classic" | "spectacle" | "bangerTest";
type Mode = "live" | "instant";

type SubmitState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "error"; message: string };

interface VotingConfigProps {
  templateId: TemplateId;
  announcementMode: Mode;
  announcementStyle: 'full' | 'short';
  allowNowPerforming: boolean;
  submitState: SubmitState;
  onChange: (patch: {
    templateId?: TemplateId;
    announcementMode?: Mode;
    announcementStyle?: 'full' | 'short';
    allowNowPerforming?: boolean;
  }) => void;
  onBack: () => void;
  onSubmit: () => void;
}

export default function VotingConfig({
  templateId,
  announcementMode,
  announcementStyle,
  allowNowPerforming,
  submitState,
  onChange,
  onBack,
  onSubmit,
}: VotingConfigProps) {
  const t = useTranslations();
  const [infoOpen, setInfoOpen] = useState(false);
  const [expandedTemplateId, setExpandedTemplateId] =
    useState<TemplateId | null>(null);
  const [expandedMode, setExpandedMode] = useState<Mode | null>(null);

  const templates = VOTING_TEMPLATES.filter((t) => t.id !== "custom");
  const submitting = submitState.kind === "submitting";

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h2 className="text-xl font-bold tracking-tight">{t("create.votingConfig.heading")}</h2>
        <p className="text-sm text-muted-foreground">
          {t("create.votingConfig.subheading")}
        </p>
      </div>

      <div className="space-y-3">
        <p className="text-sm font-medium">{t("create.votingConfig.templateLabel")}</p>
        <div className="grid grid-cols-1 gap-3">
          {templates.map((tpl) => (
            <TemplateCard
              key={tpl.id}
              template={tpl}
              selected={tpl.id === templateId}
              expanded={expandedTemplateId === (tpl.id as TemplateId)}
              onSelect={() =>
                onChange({ templateId: tpl.id as TemplateId })
              }
              onToggleInfo={() =>
                setExpandedTemplateId((curr) =>
                  nextExpandedId(curr, tpl.id as TemplateId),
                )
              }
            />
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <p className="text-sm font-medium">{t("create.votingConfig.announcementLabel")}</p>
        <div className="grid grid-cols-1 gap-2">
          {(["live", "instant"] as Mode[]).map((m) => (
            <AnnouncementModeCard
              key={m}
              mode={m}
              selected={m === announcementMode}
              expanded={expandedMode === m}
              onSelect={() => onChange({ announcementMode: m })}
              onToggleInfo={() =>
                setExpandedMode((curr) => nextExpandedId(curr, m))
              }
            />
          ))}
        </div>
        {announcementMode === "live" ? (
          <AnnouncementStyleSubRadio
            value={announcementStyle}
            onChange={(next) => onChange({ announcementStyle: next })}
          />
        ) : null}
      </div>

      <div className="space-y-2">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={allowNowPerforming}
            onChange={(e) =>
              onChange({ allowNowPerforming: e.target.checked })
            }
            className="mt-1 h-4 w-4 accent-primary"
          />
          <span className="space-y-1">
            <span className="text-sm font-medium flex items-center gap-2">
              {t("create.votingConfig.nowPerformingLabel")}
              <button
                type="button"
                aria-label="About this toggle"
                onClick={(e) => {
                  e.preventDefault();
                  setInfoOpen((v) => !v);
                }}
                className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-muted-foreground text-[10px] text-muted-foreground hover:text-foreground hover:border-foreground"
              >
                i
              </button>
            </span>
            {infoOpen && (
              <span className="block text-xs text-muted-foreground">
                {t("create.votingConfig.nowPerformingInfo")}
              </span>
            )}
          </span>
        </label>
      </div>

      {submitState.kind === "error" && (
        <p role="alert" className="text-sm text-destructive">
          {submitState.message}
        </p>
      )}

      <div className="flex justify-between gap-3">
        <Button variant="ghost" onClick={onBack} disabled={submitting}>
          {t("create.actions.back")}
        </Button>
        <Button onClick={onSubmit} disabled={submitting}>
          {submitting ? t("create.actions.creating") : t("create.actions.createRoom")}
        </Button>
      </div>
    </div>
  );
}
