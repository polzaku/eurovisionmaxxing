import Link from "next/link";
import { getTranslations } from "next-intl/server";
import Logo from "@/components/ui/Logo";

export default async function HomePage() {
  const t = await getTranslations("common");
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-12">
      <div className="max-w-md w-full text-center space-y-10 animate-fade-in">
        {/* Logo + wordmark */}
        <div className="space-y-6">
          <div className="flex justify-center">
            <Logo size={112} className="emx-glow-pink" />
          </div>
          <div className="space-y-2">
            {/*
              Mobile-first responsive sizing: "eurovisionmaxxing" is a single
              17-char unbreakable word, so at text-5xl extrabold (~48px) it
              overflows iPhone SE's ~327px usable width. Scale up with the
              viewport. `break-words` is a safety net for edge-case narrow
              screens — the gradient will clip to each resulting line if it
              ever needs to wrap.
            */}
            <h1 className="text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tight emx-wordmark text-balance leading-tight break-words">
              {t("app.name")}
            </h1>
            <p className="text-lg sm:text-xl font-semibold text-foreground text-balance">
              {t("app.tagline")}
            </p>
            <p className="text-muted-foreground text-base sm:text-lg leading-relaxed text-balance pt-1">
              {t("app.description")}
            </p>
          </div>
        </div>

        {/* CTAs */}
        <div className="space-y-4">
          <Link
            href="/create"
            className="block w-full rounded-xl bg-primary px-6 py-4 text-lg font-semibold text-primary-foreground text-center transition-all duration-200 hover:scale-[1.02] hover:emx-glow-gold active:scale-[0.98]"
          >
            {t("cta.startRoom")}
          </Link>
          <Link
            href="/join"
            className="block w-full rounded-xl border-2 border-border px-6 py-4 text-lg font-semibold text-foreground text-center transition-all duration-200 hover:scale-[1.02] hover:border-accent hover:emx-glow-pink active:scale-[0.98]"
          >
            {t("cta.joinRoom")}
          </Link>
        </div>

        {/* Micro-meta strip */}
        <p className="text-sm text-muted-foreground">
          {t("tagline.feature")}
        </p>
      </div>
    </main>
  );
}
