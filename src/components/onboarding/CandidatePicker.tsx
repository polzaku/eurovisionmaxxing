"use client";

import { useTranslations } from "next-intl";
import Avatar from "@/components/ui/Avatar";

interface Candidate {
  userId: string;
  avatarSeed: string;
}

interface CandidatePickerProps {
  candidates: Candidate[];
  onPick: (candidate: Candidate) => void;
  onCreateNew: () => void;
  onChangeName: () => void;
  submitting: boolean;
}

export default function CandidatePicker({
  candidates,
  onPick,
  onCreateNew,
  onChangeName,
  submitting,
}: CandidatePickerProps) {
  const t = useTranslations("onboarding.picker");
  return (
    <div
      className="mx-auto w-full max-w-md space-y-8 px-6 py-10 animate-fade-in"
      aria-live="polite"
    >
      <div className="text-center space-y-2">
        <h1 className="text-2xl font-bold text-foreground">{t("title")}</h1>
        <p className="text-muted-foreground text-sm text-balance">
          {t("subtitle")}
        </p>
      </div>

      <div className="flex flex-wrap justify-center gap-4">
        {candidates.map((c) => (
          <button
            key={c.userId}
            type="button"
            onClick={() => onPick(c)}
            disabled={submitting}
            aria-label={t("pickAria")}
            className="rounded-full border-2 border-border p-1 transition-colors hover:border-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Avatar seed={c.avatarSeed} size={96} />
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={onCreateNew}
        disabled={submitting}
        className="block w-full rounded-xl bg-primary px-6 py-4 text-lg font-semibold text-primary-foreground transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
      >
        {t("createNew")}
      </button>

      <div className="text-center">
        <button
          type="button"
          onClick={onChangeName}
          disabled={submitting}
          className="text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t("changeName")}
        </button>
      </div>
    </div>
  );
}
