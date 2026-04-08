"use client";

/**
 * Fullscreen presentation screen for TV/AirPlay.
 * Shows live leaderboard during announcement, animated rank changes.
 * Landscape-optimised, no navigation chrome.
 *
 * TODO: Implement fullscreen leaderboard with realtime updates
 */

export default function PresentPage({ params }: { params: { id: string } }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-navy text-white">
      <div className="text-center space-y-4">
        <h1 className="text-5xl font-bold">
          <span className="text-gold">eurovision</span>
          <span className="text-hot-pink">maxxing</span>
        </h1>
        <p className="text-xl text-white/60">
          Presentation screen — Room {params.id}
        </p>
        {/* TODO: Animated leaderboard, point reveals, announcer indicator */}
      </div>
    </main>
  );
}
