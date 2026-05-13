import type { ResultsData } from "@/lib/results/loadResults";
import { EXPORT_STYLESHEET } from "@/lib/export/exportStylesheet";
import { escapeHtml } from "@/lib/export/escapeHtml";
import { renderAvatarSvg } from "@/lib/export/dicebearInline";
import { computeWeightedScore } from "@/lib/scoring";

type DonePayload = Extract<ResultsData, { status: "done" }>;

export interface BuildResultsHtmlDeps {
  /** Locale-resolved translator (caller scopes namespace separately if needed). */
  t: (key: string, params?: Record<string, unknown>) => string;
  /** Injected clock for deterministic tests. */
  now: () => Date;
  /** Hostname for the footer link, e.g. "eurovisionmaxxing.com". */
  appHostname: string;
  /** Forward-compat: bets data when R7/V2 ships. Section is suppressed when undefined. */
  bets?: unknown;
}

export interface BuildResultsHtmlOutput {
  html: string;
  filename: string;
  bytes: number;
}

const FILENAME_BAD_CHARS = /[^A-Za-z0-9._-]/g;

function buildFilename(year: number, event: string, pin: string): string {
  const safePin = pin.replace(FILENAME_BAD_CHARS, "");
  return `emx-${year}-${event}-${safePin}.html`;
}

function renderHeader(data: DonePayload, t: BuildResultsHtmlDeps["t"], now: Date): string {
  return `<header><h1>${escapeHtml(
    t("export.title", { year: data.year, event: data.event, pin: data.pin }),
  )}</h1><p class="meta">${escapeHtml(
    t("export.header.generatedAt", { timestamp: now.toISOString() }),
  )}</p></header>`;
}

function renderLeaderboard(data: DonePayload, t: BuildResultsHtmlDeps["t"]): string {
  const contestantById = new Map(data.contestants.map((c) => [c.id, c]));
  const drillByContestant = new Map(
    data.contestantBreakdowns.map((cb) => [cb.contestantId, cb]),
  );

  const rows = data.leaderboard
    .map((row) => {
      const c = contestantById.get(row.contestantId);
      if (!c) return "";
      const isTwelve = row.totalPoints >= 12 && row.rank === 1;
      const trClass = isTwelve ? ` class="twelve"` : "";
      const drill = drillByContestant.get(row.contestantId);
      const drillSection = drill
        ? `<tr><td colspan="4"><details><summary>${escapeHtml(
            t("export.contestantDrillDown.heading", { country: c.country }),
          )}</summary><table><thead><tr><th>${escapeHtml(
            t("export.contestantDrillDown.voter"),
          )}</th><th>${escapeHtml(
            t("export.contestantDrillDown.weightedScore", { value: "" }).replace(/\s*$/, ""),
          )}</th><th>${escapeHtml(
            t("export.contestantDrillDown.points"),
          )}</th></tr></thead><tbody>${drill.gives
            .map((g) => {
              const detail = data.voteDetails.find(
                (v) => v.userId === g.userId && v.contestantId === c.id,
              );
              const weighted = detail
                ? computeWeightedScore(detail.scores, data.categories)
                : 0;
              return `<tr><td>${escapeHtml(g.displayName)}</td><td>${
                detail
                  ? `<span class="${detail.missed ? "chip chip--missed" : "chip"}">${
                      detail.missed ? "~" : ""
                    }${weighted.toFixed(1)}</span>`
                  : ""
              }</td><td><span class="points-pill${
                g.pointsAwarded === 12 ? " twelve" : ""
              }">${g.pointsAwarded}</span></td></tr>`;
            })
            .join("")}</tbody></table></details></td></tr>`
        : "";
      return `<tr${trClass}><td>${row.rank}</td><td>${c.flagEmoji} ${escapeHtml(
        c.country,
      )}</td><td>${escapeHtml(c.song)} · ${escapeHtml(c.artist)}</td><td class="points">${
        row.totalPoints
      }</td></tr>${drillSection}`;
    })
    .join("");

  return `<section class="leaderboard"><h2>${escapeHtml(
    t("export.leaderboard.heading"),
  )}</h2><table><thead><tr><th>${escapeHtml(t("export.leaderboard.rank"))}</th><th>${escapeHtml(
    t("export.leaderboard.country"),
  )}</th><th>${escapeHtml(t("export.leaderboard.song"))}</th><th>${escapeHtml(
    t("export.leaderboard.points"),
  )}</th></tr></thead><tbody>${rows}</tbody></table></section>`;
}

function renderAwards(data: DonePayload, t: BuildResultsHtmlDeps["t"]): string {
  if (data.awards.length === 0) {
    return `<section class="awards"><h2>${escapeHtml(
      t("export.awards.heading"),
    )}</h2><p>${escapeHtml(t("export.awards.empty"))}</p></section>`;
  }
  const memberById = new Map(data.members.map((m) => [m.userId, m]));
  const contestantById = new Map(data.contestants.map((c) => [c.id, c]));
  const cards = data.awards
    .map((a) => {
      const winnerMember = a.winnerUserId ? memberById.get(a.winnerUserId) : null;
      const partner = a.winnerUserIdB ? memberById.get(a.winnerUserIdB) : null;
      const winnerContestant = a.winnerContestantId
        ? contestantById.get(a.winnerContestantId)
        : null;
      const winnerLabel = winnerMember
        ? partner
          ? `${escapeHtml(
              t("export.awards.jointWinners"),
            )}: ${escapeHtml(winnerMember.displayName)} &amp; ${escapeHtml(
              partner.displayName,
            )}`
          : escapeHtml(winnerMember.displayName)
        : winnerContestant
          ? `${winnerContestant.flagEmoji} ${escapeHtml(winnerContestant.country)}`
          : "";
      const drill = winnerContestant
        ? `<details><summary>${escapeHtml(
            t("export.categoryDrillDown.heading", { category: a.awardName }),
          )}</summary><p>${escapeHtml(
            t("export.categoryDrillDown.mean", { value: a.statValue?.toFixed(1) ?? "" }),
          )}</p></details>`
        : "";
      return `<article class="award"><h3>${escapeHtml(
        a.awardName,
      )} — ${winnerLabel}<span class="badge">${escapeHtml(
        t("export.awards.winner"),
      )}</span></h3>${drill}</article>`;
    })
    .join("");
  return `<section class="awards"><h2>${escapeHtml(
    t("export.awards.heading"),
  )}</h2>${cards}</section>`;
}

function renderBreakdowns(
  data: DonePayload,
  t: BuildResultsHtmlDeps["t"],
): string {
  const contestantById = new Map(data.contestants.map((c) => [c.id, c]));
  const articles = data.breakdowns
    .map((b) => {
      const topPick = b.picks[0];
      const topCountry = topPick
        ? contestantById.get(topPick.contestantId)?.country ?? ""
        : "";
      const avatar = renderAvatarSvg(b.avatarSeed);
      const picksList = b.picks
        .map(
          (p) =>
            `<li>${p.pointsAwarded} — ${
              contestantById.get(p.contestantId)?.flagEmoji ?? ""
            } ${escapeHtml(contestantById.get(p.contestantId)?.country ?? "")}</li>`,
        )
        .join("");
      const ownVoteDetails = data.voteDetails.filter((v) => v.userId === b.userId);
      const drillRows = ownVoteDetails
        .sort((a, c) => c.pointsAwarded - a.pointsAwarded)
        .map((v) => {
          const c = contestantById.get(v.contestantId);
          if (!c) return "";
          return `<tr><td>${c.flagEmoji} ${escapeHtml(c.country)}</td><td><span class="${
            v.missed ? "chip chip--missed" : "chip"
          }">${v.missed ? "~" : ""}${computeWeightedScore(v.scores, data.categories).toFixed(
            1,
          )}</span></td><td><span class="points-pill${
            v.pointsAwarded === 12 ? " twelve" : ""
          }">${v.pointsAwarded}</span></td></tr>`;
        })
        .join("");
      const drill = drillRows
        ? `<details><summary>${escapeHtml(
            t("export.participantDrillDown.heading", { name: b.displayName }),
          )}</summary><table><tbody>${drillRows}</tbody></table></details>`
        : "";
      return `<article><h3><span class="avatar">${avatar}</span>${escapeHtml(
        t("export.breakdowns.topPick", {
          name: b.displayName,
          country: topCountry,
        }),
      )}</h3><ol class="picks">${picksList}</ol>${drill}</article>`;
    })
    .join("");
  return `<section class="breakdowns"><h2>${escapeHtml(
    t("export.breakdowns.heading"),
  )}</h2>${articles}</section>`;
}

function renderHotTakes(data: DonePayload, t: BuildResultsHtmlDeps["t"]): string {
  if (data.hotTakes.length === 0) {
    return `<section class="hot-takes"><h2>${escapeHtml(
      t("export.hotTakes.heading"),
    )}</h2><p class="empty">${escapeHtml(t("export.hotTakes.empty"))}</p></section>`;
  }
  const contestantById = new Map(data.contestants.map((c) => [c.id, c]));
  const blocks = data.hotTakes
    .map((h) => {
      const c = contestantById.get(h.contestantId);
      const country = c ? `${c.flagEmoji} ${escapeHtml(c.country)}` : "";
      const editedTag = h.hotTakeEditedAt
        ? `<span class="edited">${escapeHtml(t("export.hotTakes.edited"))}</span>`
        : "";
      return `<blockquote><span class="author">${escapeHtml(
        h.displayName,
      )} → ${country} ${editedTag}</span>${escapeHtml(h.hotTake)}</blockquote>`;
    })
    .join("");
  return `<section class="hot-takes"><h2>${escapeHtml(
    t("export.hotTakes.heading"),
  )}</h2>${blocks}</section>`;
}

function renderFooter(
  data: DonePayload,
  t: BuildResultsHtmlDeps["t"],
  now: Date,
  appHostname: string,
): string {
  return `<footer>${escapeHtml(
    t("export.footer", {
      timestamp: now.toISOString(),
      hostname: appHostname,
      roomId: data.pin,
    }),
  )}</footer>`;
}

export function buildResultsHtml(
  data: DonePayload,
  deps: BuildResultsHtmlDeps,
): BuildResultsHtmlOutput {
  const now = deps.now();
  const title = escapeHtml(
    deps.t("export.title", { year: data.year, event: data.event, pin: data.pin }),
  );

  const body = [
    renderHeader(data, deps.t, now),
    `<main>`,
    renderLeaderboard(data, deps.t),
    renderAwards(data, deps.t),
    renderBreakdowns(data, deps.t),
    renderHotTakes(data, deps.t),
    `</main>`,
    renderFooter(data, deps.t, now, deps.appHostname),
  ].join("");

  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${EXPORT_STYLESHEET}</style></head><body>${body}</body></html>`;

  return {
    html,
    filename: buildFilename(data.year, data.event, data.pin),
    bytes: Buffer.byteLength(html, "utf8"),
  };
}
