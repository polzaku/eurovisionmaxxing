"use client";

/**
 * Room Creation Wizard — 3 steps:
 * 1. Event selection (year + event type)
 * 2. Voting configuration (template or custom categories)
 * 3. Room ready (PIN, QR, shareable link)
 *
 * TODO: Implement full wizard UI
 */

export default function CreateRoomPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-12">
      <div className="max-w-md w-full space-y-6">
        <h1 className="text-2xl font-bold">Create a Room</h1>
        <p className="text-muted-foreground">
          Room creation wizard coming soon — 3 steps: event selection,
          voting config, and room ready.
        </p>
        {/* TODO: Step 1 - EventSelection, Step 2 - VotingConfig, Step 3 - RoomReady */}
      </div>
    </main>
  );
}
