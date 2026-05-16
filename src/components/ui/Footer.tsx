"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

const GITHUB_URL = "https://github.com/polzaku/eurovisionmaxxing";

export default function Footer() {
  const t = useTranslations("footer");
  const pathname = usePathname();

  // Match ThemeToggle/LocaleSwitcher: hide on the TV /present surface so
  // nothing leaks into the broadcast.
  if (pathname?.endsWith("/present") || pathname?.includes("/present/")) {
    return null;
  }

  return (
    <footer
      data-testid="app-footer"
      className="mt-12 border-t border-border bg-background/60 px-6 py-6 text-sm text-muted-foreground"
    >
      <div className="mx-auto flex max-w-4xl flex-col items-center gap-3 text-center">
        <nav className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
          <Link
            href="/about"
            data-testid="footer-link-about"
            className="hover:text-foreground hover:underline"
          >
            {t("links.about")}
          </Link>
          <span aria-hidden className="text-border">·</span>
          <Link
            href="/privacy"
            data-testid="footer-link-privacy"
            className="hover:text-foreground hover:underline"
          >
            {t("links.privacy")}
          </Link>
          <span aria-hidden className="text-border">·</span>
          <Link
            href="/terms"
            data-testid="footer-link-terms"
            className="hover:text-foreground hover:underline"
          >
            {t("links.terms")}
          </Link>
          <span aria-hidden className="text-border">·</span>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer noopener"
            data-testid="footer-link-source"
            className="hover:text-foreground hover:underline"
          >
            {t("links.source")}
          </a>
        </nav>
        <p className="text-xs leading-relaxed text-balance">
          {t("disclaimer")}
        </p>
        <p className="text-xs">{t("copyright", { year: new Date().getFullYear() })}</p>
      </div>
    </footer>
  );
}
