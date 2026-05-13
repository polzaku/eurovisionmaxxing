import { describe, it, expect, beforeEach } from "vitest";
import {
  buildResultsHtml,
  type BuildResultsHtmlDeps,
} from "@/lib/export/buildResultsHtml";
import { FIXTURE_DONE_15x26 } from "@/lib/export/__fixtures__/done-15x26";
import type { ResultsData } from "@/lib/results/loadResults";
import { _resetCache } from "@/lib/export/dicebearInline";

type DonePayload = Extract<ResultsData, { status: "done" }>;

function makeT(prefix = "en"): BuildResultsHtmlDeps["t"] {
  // Mirrors next-intl's namespace-scoped translator: getTranslations({
  // namespace: "export" }) returns a t() that auto-prefixes every key with
  // "export." when resolving messages. Callers in buildResultsHtml therefore
  // pass bare keys (t("leaderboard.heading")) and assertions in this file
  // check the fully-resolved "{prefix}:export.leaderboard.heading".
  return (key, params) => {
    const fullKey = `export.${key}`;
    if (params && Object.keys(params).length) {
      const rendered = Object.entries(params).reduce(
        (s, [k, v]) => s.replace(`{${k}}`, String(v)),
        fullKey,
      );
      return `${prefix}:${rendered}`;
    }
    return `${prefix}:${fullKey}`;
  };
}

function makeDeps(prefix = "en"): BuildResultsHtmlDeps {
  return {
    t: makeT(prefix),
    locale: prefix,
    now: () => new Date("2026-05-16T22:30:00Z"),
    appHostname: "eurovisionmaxxing.com",
  };
}

beforeEach(() => {
  _resetCache();
});

describe("buildResultsHtml", () => {
  it("renders the canonical 15×26 fixture under the 300 KB budget", () => {
    const { html, bytes } = buildResultsHtml(FIXTURE_DONE_15x26, makeDeps());
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(bytes).toBe(Buffer.byteLength(html, "utf8"));
    expect(bytes).toBeLessThanOrEqual(300 * 1024);
  });

  it("emits the correct filename for a final room", () => {
    const { filename } = buildResultsHtml(FIXTURE_DONE_15x26, makeDeps());
    expect(filename).toBe("emx-2026-final-TESTPN.html");
  });

  it("sanitises the filename — no quotes, slashes, or path separators", () => {
    const evil: DonePayload = { ...FIXTURE_DONE_15x26, pin: 'A"B/C\\D' };
    const { filename } = buildResultsHtml(evil, makeDeps());
    expect(filename).not.toMatch(/["/\\]/);
  });

  it("sanitises the event segment of the filename too", () => {
    const evil: DonePayload = {
      ...FIXTURE_DONE_15x26,
      // EventType is typed but the renderer accepts any string — defensive.
      event: '../etc/passwd"' as DonePayload["event"],
    };
    const { filename } = buildResultsHtml(evil, makeDeps());
    expect(filename).not.toMatch(/["/\\]/);
    expect(filename).not.toContain("..");
  });

  it("emits <html lang> reflecting the resolved locale", () => {
    expect(buildResultsHtml(FIXTURE_DONE_15x26, makeDeps("es")).html).toMatch(
      /<html\s+lang="es"/,
    );
    expect(buildResultsHtml(FIXTURE_DONE_15x26, makeDeps("uk")).html).toMatch(
      /<html\s+lang="uk"/,
    );
  });

  it("inlines the stylesheet", () => {
    const { html } = buildResultsHtml(FIXTURE_DONE_15x26, makeDeps());
    expect(html).toMatch(new RegExp("<style>.*?@media\\s+print.*?<\\/style>", "s"));
  });

  it("inlines avatar SVGs in the breakdowns section", () => {
    const { html } = buildResultsHtml(FIXTURE_DONE_15x26, makeDeps());
    expect(html).toMatch(/<svg/);
  });

  it("escapes user-provided strings", () => {
    const evil: DonePayload = {
      ...FIXTURE_DONE_15x26,
      hotTakes: [
        {
          userId: "user-01",
          displayName: "Voter A",
          avatarSeed: "seed-1",
          contestantId: FIXTURE_DONE_15x26.leaderboard[0].contestantId,
          hotTake: "<script>alert(1)</script>",
          hotTakeEditedAt: null,
        },
      ],
      members: [
        ...FIXTURE_DONE_15x26.members.slice(1),
        { userId: "user-01", displayName: "Voter <A> & B", avatarSeed: "seed-1" },
      ],
    };
    const { html } = buildResultsHtml(evil, makeDeps());
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("Voter &lt;A&gt; &amp; B");
  });

  it("renders missed entries with the chip--missed class and ~ prefix", () => {
    const withMissed: DonePayload = {
      ...FIXTURE_DONE_15x26,
      voteDetails: FIXTURE_DONE_15x26.voteDetails.map((v, i) =>
        i === 0 ? { ...v, missed: true } : v,
      ),
    };
    const { html } = buildResultsHtml(withMissed, makeDeps());
    expect(html).toContain("chip--missed");
    expect(html).toContain("~");
  });

  it("renders the (edited) tag for edited hot takes", () => {
    const withEdited: DonePayload = {
      ...FIXTURE_DONE_15x26,
      hotTakes: [
        {
          userId: "user-01",
          displayName: "Voter A",
          avatarSeed: "seed-1",
          contestantId: FIXTURE_DONE_15x26.leaderboard[0].contestantId,
          hotTake: "Yes",
          hotTakeEditedAt: "2026-05-16T22:00:00Z",
        },
      ],
    };
    const { html } = buildResultsHtml(withEdited, makeDeps());
    expect(html).toContain("en:export.hotTakes.edited");
  });

  it("renders joint-winners caption when winnerUserIdB is set", () => {
    const { html } = buildResultsHtml(FIXTURE_DONE_15x26, makeDeps());
    expect(html).toContain("en:export.awards.jointWinners");
  });

  it("does not leak English when t is locale-prefixed", () => {
    const { html } = buildResultsHtml(FIXTURE_DONE_15x26, makeDeps("es"));
    expect(html).not.toContain("en:export.");
    expect(html).toContain("es:export.");
  });

  it("renders the empty-state copy for hot-takes when there are none", () => {
    const noHotTakes: DonePayload = { ...FIXTURE_DONE_15x26, hotTakes: [] };
    const { html } = buildResultsHtml(noHotTakes, makeDeps());
    expect(html).toContain("en:export.hotTakes.empty");
  });

  it("emits inline <details> drill-down blocks under leaderboard rows", () => {
    const { html } = buildResultsHtml(FIXTURE_DONE_15x26, makeDeps());
    expect(html).toContain("en:export.contestantDrillDown.heading");
  });

  it("emits participant drill-down sections under each breakdown article", () => {
    const { html } = buildResultsHtml(FIXTURE_DONE_15x26, makeDeps());
    expect(html).toContain("en:export.participantDrillDown.heading");
  });

  it("emits category drill-down under each category award", () => {
    const { html } = buildResultsHtml(FIXTURE_DONE_15x26, makeDeps());
    expect(html).toContain("en:export.categoryDrillDown.heading");
  });

  it("suppresses the bets section when betsEnabled is false (default)", () => {
    const { html } = buildResultsHtml(FIXTURE_DONE_15x26, makeDeps());
    expect(html).not.toMatch(/<section[^>]*class="bets"/);
  });

  it("includes the footer with generated-at + roomId-derived path", () => {
    const { html } = buildResultsHtml(FIXTURE_DONE_15x26, makeDeps());
    expect(html).toContain("en:export.footer");
  });
});
