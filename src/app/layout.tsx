import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import I18nProvider from "@/i18n/provider";
import ThemeToggle from "@/components/ui/ThemeToggle";
import LocaleSwitcher from "@/components/ui/LocaleSwitcher";
import "./globals.css";

/**
 * SPEC §3.4 FOUC-prevention: read emx_theme from localStorage and set
 * <html data-theme> BEFORE first paint. Without this, users who picked
 * Light on a dark-prefers system would see a flash of dark before
 * <ThemeToggle>'s useEffect fires.
 */
const THEME_BOOTSTRAP_SCRIPT = `(function(){try{var t=localStorage.getItem('emx_theme');if(t==='light'||t==='dark'){document.documentElement.dataset.theme=t}}catch(e){}})();`;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return {
    title: t("app.name"),
    description: t("app.metaDescription"),
    manifest: "/manifest.json",
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#0a0a14",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();
  const messages = await getMessages();
  return (
    <html lang={locale}>
      <head>
        <script
          // The script is a static, hardcoded constant — no dynamic data
          // is interpolated. dangerouslySetInnerHTML is required to bypass
          // Next's automatic <Script> hydration and inline it in <head>
          // so it runs before paint (FOUC prevention).
          dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }}
        />
      </head>
      <body className={`${GeistSans.variable} font-sans antialiased min-h-screen bg-background text-foreground`}>
        <I18nProvider locale={locale} messages={messages}>
          <ThemeToggle />
          <LocaleSwitcher />
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
