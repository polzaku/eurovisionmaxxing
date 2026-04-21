import {
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
  type SupportedLocale,
} from "@/i18n/config";

const SUPPORTED_SET = new Set<string>(SUPPORTED_LOCALES);

interface ParsedTag {
  primary: string;
  q: number;
}

function parseAcceptLanguage(header: string): ParsedTag[] {
  return header
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map<ParsedTag | null>((entry) => {
      const [tagRaw, ...params] = entry.split(";");
      const tag = tagRaw?.trim().toLowerCase() ?? "";
      const primary = tag.split("-")[0] ?? "";
      if (!primary || !/^[a-z]{2,3}$/.test(primary)) return null;
      let q = 1;
      for (const param of params) {
        const [k, v] = param.trim().split("=");
        if (k === "q" && v !== undefined) {
          const parsed = Number.parseFloat(v);
          if (!Number.isNaN(parsed)) q = parsed;
        }
      }
      return { primary, q };
    })
    .filter((entry): entry is ParsedTag => entry !== null)
    .sort((a, b) => b.q - a.q);
}

export function pickLocale(header: string | null | undefined): SupportedLocale {
  if (!header || !header.trim()) return DEFAULT_LOCALE;
  const tags = parseAcceptLanguage(header);
  for (const { primary } of tags) {
    if (SUPPORTED_SET.has(primary)) return primary as SupportedLocale;
  }
  return DEFAULT_LOCALE;
}
