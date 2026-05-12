"use client";

import { useTranslations } from "next-intl";

type Status = "voting" | "scoring" | "announcing" | "done";

interface StatusStubProps {
  status: string;
}

export default function StatusStub({ status }: StatusStubProps) {
  const t = useTranslations("room.status");
  const statusKey = (["voting", "scoring", "announcing", "done"] as Status[]).includes(status as Status)
    ? (status as Status)
    : null;
  const label = statusKey ? t(statusKey) : t("fallback");
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-12">
      <div className="max-w-md w-full space-y-4 text-center animate-fade-in">
        <h1 className="text-2xl font-bold tracking-tight">{label}</h1>
        <p className="text-muted-foreground text-sm">
          {t("wip")}
        </p>
        <p className="text-muted-foreground text-xs font-mono">
          Status: {status}
        </p>
      </div>
    </main>
  );
}
