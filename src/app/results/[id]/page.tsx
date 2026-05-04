import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { loadResults, type ResultsData } from "@/lib/results/loadResults";
import { formatRoomSummary } from "@/lib/results/formatRoomSummary";
import { createServiceClient } from "@/lib/supabase/server";
import { fetchContestants, fetchContestantsMeta } from "@/lib/contestants";
import type { Contestant } from "@/types";
import ScoringPoller from "./ScoringPoller";
import CopySummaryButton from "./CopySummaryButton";
import AwardsSection from "@/components/results/AwardsSection";

export async function generateMetadata({
  params,
}: {
  params: { id: string };
}): Promise<Metadata> {
  const t = await getTranslations("results");
  const data = await load(params.id);
  const pin =
    data && "pin" in data && typeof data.pin === "string" ? data.pin : null;
  return {
    title: pin ? `${t("title")} – ${pin}` : t("title"),
  };
}

async function load(roomId: string): Promise<ResultsData | null> {
  const result = await loadResults(
    { roomId },
    {
      supabase: createServiceClient(),
      fetchContestants,
      fetchContestantsMeta,
    },
  );
  return result.ok ? result.data : null;
}

export default async function PublicResultsPage({
  params,
}: {
  params: { id: string };
}) {
  const t = await getTranslations("results");
  const data = await load(params.id);

  return (
    <main className="flex min-h-screen flex-col items-center px-6 py-10">
      <div className="max-w-3xl w-full space-y-8 motion-safe:animate-fade-in">
        <Header title={t("title")} />
        {data === null ? (
          <PlaceholderCard body={t("placeholders.roomNotFound")} />
        ) : (
          <Body data={data} roomId={params.id} />
        )}
      </div>
    </main>
  );
}

function Header({ title }: { title: string }) {
  return (
    <h1 className="text-3xl sm:text-4xl font-bold text-center tracking-tight">
      <span className="emx-wordmark">eurovisionmaxxing</span>
      <span className="text-muted-foreground"> {title.toLowerCase()}</span>
    </h1>
  );
}

function PlaceholderCard({
  body,
  footer,
}: {
  body: string;
  footer?: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border-2 border-border p-8 text-center space-y-4">
      <p className="text-base sm:text-lg text-muted-foreground">{body}</p>
      {footer}
    </section>
  );
}

async function Body({ data, roomId }: { data: ResultsData; roomId: string }) {
  switch (data.status) {
    case "lobby":
      return <LobbyCard data={data} />;
    case "voting":
    case "voting_ending":
      return <VotingCard data={data} />;
    case "scoring":
      return <ScoringCard roomId={roomId} />;
    case "announcing":
      return <AnnouncingBody data={data} />;
    case "done":
      return <DoneBody data={data} roomId={roomId} />;
  }
}

// ─── lobby ───────────────────────────────────────────────────────────────────

async function LobbyCard({
  data,
}: {
  data: Extract<ResultsData, { status: "lobby" }>;
}) {
  const t = await getTranslations("results");
  return (
    <PlaceholderCard
      body={t("placeholders.lobby")}
      footer={
        data.broadcastStartUtc ? (
          <LobbyCountdown broadcastStartUtc={data.broadcastStartUtc} />
        ) : null
      }
    />
  );
}

function LobbyCountdown({ broadcastStartUtc }: { broadcastStartUtc: string }) {
  // Server-side only: render the absolute time. A future follow-up can
  // turn this into a ticking countdown (client component) — the spec
  // mentions a countdown but it's cosmetic.
  const d = new Date(broadcastStartUtc);
  const label = d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  return <p className="text-sm text-muted-foreground">{label}</p>;
}

// ─── voting / voting_ending ──────────────────────────────────────────────────

async function VotingCard({
  data,
}: {
  data: Extract<ResultsData, { status: "voting" | "voting_ending" }>;
}) {
  const t = await getTranslations("results");
  return (
    <PlaceholderCard
      body={t("placeholders.voting")}
      footer={
        <Link
          href={`/join?pin=${data.pin}`}
          className="inline-block rounded-xl bg-primary px-6 py-3 font-semibold text-primary-foreground transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
        >
          {t("placeholders.votingCta")}
        </Link>
      }
    />
  );
}

// ─── scoring ─────────────────────────────────────────────────────────────────

async function ScoringCard({ roomId }: { roomId: string }) {
  const t = await getTranslations("results");
  return (
    <section className="rounded-2xl border-2 border-border p-8 text-center space-y-4 motion-safe:animate-shimmer overflow-hidden">
      <p className="text-base sm:text-lg text-muted-foreground">
        {t("placeholders.scoring")}
      </p>
      <ScoringPoller roomId={roomId} />
    </section>
  );
}

// ─── announcing ──────────────────────────────────────────────────────────────

async function AnnouncingBody({
  data,
}: {
  data: Extract<ResultsData, { status: "announcing" }>;
}) {
  const t = await getTranslations("results");
  return (
    <>
      <div className="rounded-xl bg-accent/10 border border-accent/30 px-4 py-3 text-center text-accent font-semibold">
        {t("announcing.banner")}
      </div>
      <Leaderboard
        title={t("headings.leaderboard")}
        leaderboard={data.leaderboard}
        contestants={data.contestants}
      />
    </>
  );
}

// ─── done ────────────────────────────────────────────────────────────────────

async function DoneBody({
  data,
  roomId,
}: {
  data: Extract<ResultsData, { status: "done" }>;
  roomId: string;
}) {
  const t = await getTranslations("results");
  const tAwards = await getTranslations("awards");

  const shareUrl =
    (process.env.NEXT_PUBLIC_APP_URL ?? "https://eurovisionmaxxing.com") +
    `/results/${roomId}`;

  const summary = formatRoomSummary({
    year: data.year,
    event: data.event,
    leaderboard: data.leaderboard,
    contestants: data.contestants,
    shareUrl,
    labels: {
      eventTitle: (year, event) => t(`eventTitle.${event}`, { year }),
      topLine: t("summary.topLine"),
      fullResults: t("summary.fullResults"),
    },
  });

  return (
    <>
      <div className="flex justify-end">
        <CopySummaryButton
          summary={summary}
          labels={{ idle: t("copySummary.idle"), done: t("copySummary.done") }}
        />
      </div>
      <Leaderboard
        title={t("headings.leaderboard")}
        leaderboard={data.leaderboard}
        contestants={data.contestants}
      />
      {data.awards.length > 0 ? (
        <AwardsSection
          awards={data.awards}
          contestants={data.contestants}
          members={data.members}
          labels={{
            sectionHeading: t("headings.awards"),
            categoryHeading: t("headings.categoryAwards"),
            personalityHeading: t("headings.personalityAwards"),
            jointCaption: tAwards("jointCaption"),
            neighbourhoodCaption: tAwards("neighbourhoodCaption"),
          }}
        />
      ) : null}
      {data.breakdowns.length > 0 ? (
        <Breakdowns
          title={t("headings.breakdowns")}
          breakdowns={data.breakdowns}
          contestants={data.contestants}
        />
      ) : null}
      {data.hotTakes.length > 0 ? (
        <HotTakes
          title={t("headings.hotTakes")}
          editedLabel={t("results.hotTake.edited")}
          hotTakes={data.hotTakes}
          contestants={data.contestants}
        />
      ) : null}
    </>
  );
}

// ─── shared subviews ─────────────────────────────────────────────────────────

function Leaderboard({
  title,
  leaderboard,
  contestants,
}: {
  title: string;
  leaderboard: Extract<ResultsData, { status: "done" }>["leaderboard"];
  contestants: Contestant[];
}) {
  const lookup = new Map<string, Contestant>(contestants.map((c) => [c.id, c]));
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold">{title}</h2>
      <ol className="divide-y divide-border rounded-xl border-2 border-border overflow-hidden">
        {leaderboard.map((e) => {
          const c = lookup.get(e.contestantId);
          return (
            <li
              key={e.contestantId}
              className="flex items-center justify-between gap-3 px-4 py-3"
            >
              <span className="flex items-center gap-3">
                <span className="tabular-nums text-sm text-muted-foreground w-6 text-right">
                  {e.rank}
                </span>
                <span className="text-2xl" aria-hidden>
                  {c?.flagEmoji ?? "🏳️"}
                </span>
                <span className="font-medium">{c?.country ?? e.contestantId}</span>
              </span>
              <span className="tabular-nums font-semibold">
                {e.totalPoints}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Breakdowns({
  title,
  breakdowns,
  contestants,
}: {
  title: string;
  breakdowns: Extract<ResultsData, { status: "done" }>["breakdowns"];
  contestants: Contestant[];
}) {
  const lookup = new Map<string, Contestant>(contestants.map((c) => [c.id, c]));
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold">{title}</h2>
      <div className="space-y-3">
        {breakdowns.map((b) => (
          <details
            key={b.userId}
            className="rounded-xl border-2 border-border overflow-hidden"
          >
            <summary className="px-4 py-3 cursor-pointer list-none font-medium flex items-center justify-between">
              <span>{b.displayName}</span>
              <span className="text-sm text-muted-foreground">
                {b.picks.length} picks
              </span>
            </summary>
            <ul className="border-t border-border divide-y divide-border">
              {b.picks.map((p) => {
                const c = lookup.get(p.contestantId);
                return (
                  <li
                    key={p.contestantId}
                    className="flex items-center justify-between gap-3 px-4 py-2"
                  >
                    <span className="flex items-center gap-2">
                      <span aria-hidden>{c?.flagEmoji ?? "🏳️"}</span>
                      <span>{c?.country ?? p.contestantId}</span>
                    </span>
                    <span className="tabular-nums font-semibold">
                      {p.pointsAwarded}
                    </span>
                  </li>
                );
              })}
            </ul>
          </details>
        ))}
      </div>
    </section>
  );
}

function HotTakes({
  title,
  editedLabel,
  hotTakes,
  contestants,
}: {
  title: string;
  editedLabel: string;
  hotTakes: Extract<ResultsData, { status: "done" }>["hotTakes"];
  contestants: Contestant[];
}) {
  const lookup = new Map<string, Contestant>(contestants.map((c) => [c.id, c]));
  // Group by country for a tidier render.
  const byCountry = new Map<string, typeof hotTakes>();
  for (const h of hotTakes) {
    const list = byCountry.get(h.contestantId) ?? [];
    list.push(h);
    byCountry.set(h.contestantId, list);
  }
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold">{title}</h2>
      <div className="space-y-4">
        {[...byCountry.entries()].map(([contestantId, takes]) => {
          const c = lookup.get(contestantId);
          return (
            <div key={contestantId} className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span aria-hidden>{c?.flagEmoji ?? "🏳️"}</span>
                <span>{c?.country ?? contestantId}</span>
              </div>
              <ul className="space-y-2">
                {takes.map((t, i) => (
                  <li
                    key={`${t.userId}-${i}`}
                    className="rounded-xl border border-border px-4 py-3"
                  >
                    <p className="text-sm text-muted-foreground mb-1">
                      {t.displayName}
                    </p>
                    <p>
                      {t.hotTake}
                      {t.hotTakeEditedAt ? (
                        <>
                          {" "}
                          <span
                            data-testid="hot-take-edited-tag"
                            className="text-xs uppercase tracking-wider text-muted-foreground"
                          >
                            {editedLabel}
                          </span>
                        </>
                      ) : null}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}

