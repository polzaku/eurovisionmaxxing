import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import I18nProvider from "@/i18n/provider";
import "./globals.css";

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
    <html lang={locale} className="dark">
      <body className={`${GeistSans.variable} font-sans antialiased min-h-screen bg-background text-foreground`}>
        <I18nProvider locale={locale} messages={messages}>
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
