"use client";

/**
 * PIN entry page — single large input, auto-uppercase, 6-char limit.
 * On submit: POST /api/rooms/join-by-pin → redirect to room URL.
 *
 * TODO: Implement full PIN entry UI
 */

export default function JoinPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-12">
      <div className="max-w-md w-full space-y-6 text-center">
        <h1 className="text-2xl font-bold">Join a Room</h1>
        <p className="text-muted-foreground">
          Enter the 6-character room PIN to join.
        </p>
        {/* TODO: PIN input component */}
      </div>
    </main>
  );
}
