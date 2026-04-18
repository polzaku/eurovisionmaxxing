import Link from "next/link";
import Logo from "@/components/ui/Logo";

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-12">
      <div className="max-w-md w-full text-center space-y-10 animate-fade-in">
        {/* Logo + wordmark */}
        <div className="space-y-6">
          <div className="flex justify-center">
            <Logo size={112} className="emx-glow-pink" />
          </div>
          <div className="space-y-2">
            <h1 className="text-5xl font-extrabold tracking-tight emx-wordmark text-balance leading-tight">
              eurovisionmaxxing
            </h1>
            <p className="text-muted-foreground text-lg">
              Vote with your friends. Announce like it&apos;s real.
            </p>
          </div>
        </div>

        {/* CTAs */}
        <div className="space-y-4">
          <Link
            href="/create"
            className="block w-full rounded-xl bg-primary px-6 py-4 text-lg font-semibold text-primary-foreground text-center transition-all duration-200 hover:scale-[1.02] hover:emx-glow-gold active:scale-[0.98]"
          >
            Create a room
          </Link>
          <Link
            href="/join"
            className="block w-full rounded-xl border-2 border-border px-6 py-4 text-lg font-semibold text-foreground text-center transition-all duration-200 hover:scale-[1.02] hover:border-accent hover:emx-glow-pink active:scale-[0.98]"
          >
            Join with PIN
          </Link>
        </div>

        {/* Fun fact */}
        <p className="text-sm text-muted-foreground">
          Did you know? Eurovision has been running since 1956.
        </p>
      </div>
    </main>
  );
}
