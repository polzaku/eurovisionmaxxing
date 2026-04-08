"use client";

/**
 * Main room page — adapts to room status:
 * - lobby: participant list, waiting for admin to start
 * - voting: voting cards (sliders, hot takes, navigation)
 * - scoring: brief transition screen
 * - announcing: live or instant results reveal
 * - done: final results + awards
 *
 * TODO: Implement status-aware room view
 */

export default function RoomPage({ params }: { params: { id: string } }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-12">
      <div className="max-w-md w-full space-y-6">
        <h1 className="text-2xl font-bold">Room</h1>
        <p className="text-muted-foreground">
          Room ID: {params.id}
        </p>
        <p className="text-muted-foreground">
          Room view adapts to status: lobby → voting → scoring → announcing → done
        </p>
        {/* TODO: Lobby, VotingUI, ScoringTransition, AnnouncingUI, DoneResults */}
      </div>
    </main>
  );
}
