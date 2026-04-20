"use client";

type Status = "voting" | "scoring" | "announcing" | "done";

const LABELS: Record<Status, string> = {
  voting: "Voting in progress",
  scoring: "Tallying results",
  announcing: "Announcement in progress",
  done: "Show's over",
};

interface StatusStubProps {
  status: string;
}

export default function StatusStub({ status }: StatusStubProps) {
  const label = LABELS[status as Status] ?? "Room active";
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-12">
      <div className="max-w-md w-full space-y-4 text-center animate-fade-in">
        <h1 className="text-2xl font-bold tracking-tight">{label}</h1>
        <p className="text-muted-foreground text-sm">
          This part of the room isn&rsquo;t built yet &mdash; coming soon.
        </p>
        <p className="text-muted-foreground text-xs font-mono">
          Status: {status}
        </p>
      </div>
    </main>
  );
}
