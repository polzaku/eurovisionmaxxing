"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import { VOTING_TEMPLATES } from "@/lib/templates";

type TemplateId = "classic" | "spectacle" | "banger";
type Mode = "live" | "instant";

type SubmitState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "error"; message: string };

interface VotingConfigProps {
  templateId: TemplateId;
  announcementMode: Mode;
  allowNowPerforming: boolean;
  submitState: SubmitState;
  onChange: (patch: {
    templateId?: TemplateId;
    announcementMode?: Mode;
    allowNowPerforming?: boolean;
  }) => void;
  onBack: () => void;
  onSubmit: () => void;
}

const MODE_LABELS: Record<Mode, { title: string; copy: string }> = {
  live: {
    title: "Live",
    copy: "Take turns announcing your points, Eurovision-style. Great with a TV.",
  },
  instant: {
    title: "Instant",
    copy: "Reveal the winner in one shot. Great if you're short on time.",
  },
};

export default function VotingConfig({
  templateId,
  announcementMode,
  allowNowPerforming,
  submitState,
  onChange,
  onBack,
  onSubmit,
}: VotingConfigProps) {
  const [infoOpen, setInfoOpen] = useState(false);
  const templates = VOTING_TEMPLATES.filter((t) => t.id !== "custom");
  const submitting = submitState.kind === "submitting";

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h2 className="text-xl font-bold tracking-tight">Voting setup</h2>
        <p className="text-sm text-muted-foreground">
          Pick a template and how you want results revealed.
        </p>
      </div>

      <div className="space-y-3">
        <p className="text-sm font-medium">Template</p>
        <div className="grid grid-cols-1 gap-3">
          {templates.map((t) => {
            const selected = t.id === templateId;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => onChange({ templateId: t.id as TemplateId })}
                className={`text-left rounded-lg border-2 px-4 py-3 transition-all ${
                  selected
                    ? "border-primary ring-2 ring-primary/30"
                    : "border-border hover:border-accent"
                }`}
              >
                <div className="space-y-1">
                  <p className="font-semibold">{t.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {t.description}
                  </p>
                  <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                    {t.categories.map((c) => (
                      <li key={c.name} className="line-clamp-1">
                        <span className="font-medium text-foreground">
                          {c.name}
                        </span>
                        {c.hint ? <> &mdash; {c.hint}</> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-3">
        <p className="text-sm font-medium">Announcement</p>
        <div className="grid grid-cols-1 gap-2">
          {(Object.keys(MODE_LABELS) as Mode[]).map((m) => {
            const selected = m === announcementMode;
            return (
              <button
                key={m}
                type="button"
                onClick={() => onChange({ announcementMode: m })}
                className={`text-left rounded-lg border-2 px-4 py-3 transition-all ${
                  selected
                    ? "border-primary ring-2 ring-primary/30"
                    : "border-border hover:border-accent"
                }`}
              >
                <p className="font-semibold">{MODE_LABELS[m].title}</p>
                <p className="text-sm text-muted-foreground">
                  {MODE_LABELS[m].copy}
                </p>
              </button>
            );
          })}
        </div>
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
              Sync everyone to the performing act
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
                Lets you tap the currently-performing country to bring all
                guests to that card during voting. Off by default.
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
          Back
        </Button>
        <Button onClick={onSubmit} disabled={submitting}>
          {submitting ? "Creating…" : "Create room"}
        </Button>
      </div>
    </div>
  );
}
