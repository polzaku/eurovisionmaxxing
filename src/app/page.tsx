import Link from "next/link";

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-12">
      <div className="max-w-md w-full text-center space-y-8">
        {/* Logo / Title */}
        <div className="space-y-2">
          <h1 className="text-4xl font-bold tracking-tight">
            <span className="text-primary">eurovision</span>
            <span className="text-accent">maxxing</span>
          </h1>
          <p className="text-muted-foreground text-lg">
            Vote with your friends. Announce like it&apos;s real.
          </p>
        </div>

        {/* CTAs */}
        <div className="space-y-4">
          <Link
            href="/create"
            className="block w-full rounded-xl bg-primary px-6 py-4 text-lg font-semibold text-primary-foreground text-center transition-transform hover:scale-[1.02] active:scale-[0.98]"
          >
            Create a room
          </Link>
          <Link
            href="/join"
            className="block w-full rounded-xl border-2 border-border px-6 py-4 text-lg font-semibold text-foreground text-center transition-transform hover:scale-[1.02] active:scale-[0.98] hover:border-primary"
          >
            Join with PIN
          </Link>
        </div>

        {/* Fun fact placeholder */}
        <p className="text-sm text-muted-foreground">
          Did you know? Eurovision has been running since 1956.
        </p>
      </div>
    </main>
  );
}
