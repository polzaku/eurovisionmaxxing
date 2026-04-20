"use client";

import { NextIntlClientProvider, type AbstractIntlMessages } from "next-intl";
import { useEffect } from "react";
import { LOCALE_STORAGE_KEY, isSupportedLocale } from "@/i18n/config";

interface Props {
  locale: string;
  messages: AbstractIntlMessages;
  children: React.ReactNode;
}

export default function I18nProvider({ locale, messages, children }: Props) {
  useEffect(() => {
    if (!isSupportedLocale(locale)) return;
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
      // Quota or privacy-mode failure — non-fatal; cookie remains the SoT.
    }
  }, [locale]);

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}
