/**
 * Public read-only results page — no auth required.
 * Shows: final leaderboard, each user's points breakdown,
 * all awards, all hot takes.
 *
 * TODO: Implement public results view
 */

export default function PublicResultsPage({ params }: { params: { id: string } }) {
  return (
    <main className="flex min-h-screen flex-col items-center px-6 py-12">
      <div className="max-w-2xl w-full space-y-6">
        <h1 className="text-2xl font-bold text-center">
          <span className="text-primary">eurovision</span>
          <span className="text-accent">maxxing</span>
          <span className="text-muted-foreground"> results</span>
        </h1>
        <p className="text-muted-foreground text-center">
          Results for room {params.id}
        </p>
        {/* TODO: Leaderboard, user breakdowns, awards, hot takes */}
      </div>
    </main>
  );
}
