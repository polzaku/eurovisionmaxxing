import Link from "next/link";

interface DoneCardProps {
  roomId: string;
}

/**
 * Reusable "Show's over → See full results" card. Shared between the
 * room page (rendered when `room.status === 'done'`) and the announcer
 * who just tapped the final reveal (rendered immediately by AnnouncingView
 * via `finishedLocal` state, ahead of the broadcast roundtrip).
 */
export default function DoneCard({ roomId }: DoneCardProps) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-8">
      <div className="max-w-md w-full space-y-6 motion-safe:animate-fade-in text-center">
        <h1 className="text-3xl font-extrabold tracking-tight emx-wordmark">
          Show&rsquo;s over
        </h1>
        <p className="text-base text-muted-foreground">
          Every score has been revealed. Time for the final picture.
        </p>
        <Link
          href={`/results/${roomId}`}
          className="block rounded-xl bg-primary px-6 py-4 text-lg font-semibold text-primary-foreground transition-all hover:scale-[1.02] hover:emx-glow-gold active:scale-[0.98]"
        >
          See full results
        </Link>
      </div>
    </main>
  );
}
