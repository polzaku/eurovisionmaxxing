"use client";

import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import QrCode from "@/components/ui/QrCode";
import type { Room } from "@/types";

interface RoomReadyProps {
  room: Room;
  onBack: () => void;
  onStartLobby: () => void;
}

function roomUrl(roomId: string): string {
  if (typeof window !== "undefined") {
    const configured = process.env.NEXT_PUBLIC_APP_URL;
    const base = configured ?? window.location.origin;
    return `${base}/room/${roomId}`;
  }
  return `/room/${roomId}`;
}

function CopyButton({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => setCopied(true));
      }}
      className="text-sm text-muted-foreground hover:text-foreground"
    >
      {copied ? "Copied!" : label}
    </button>
  );
}

export default function RoomReady({
  room,
  onBack,
  onStartLobby,
}: RoomReadyProps) {
  const url = roomUrl(room.id);

  return (
    <div className="space-y-8">
      <div className="space-y-1 text-center">
        <h2 className="text-xl font-bold tracking-tight">Room ready</h2>
        <p className="text-sm text-muted-foreground">
          Share the PIN, QR code, or link with your group.
        </p>
      </div>

      <section className="text-center space-y-2">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">
          Room PIN
        </p>
        <div className="flex items-center justify-center gap-3">
          <span className="text-4xl font-mono font-bold tracking-[0.5em]">
            {room.pin}
          </span>
          <CopyButton label="Copy" value={room.pin} />
        </div>
      </section>

      <section className="flex flex-col items-center gap-2">
        <QrCode url={url} size={256} alt="Scan to join this room" />
        <p className="text-xs text-muted-foreground">Scan to join</p>
      </section>

      <section className="space-y-2">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">
          Share link
        </p>
        <div className="flex items-center gap-2 rounded-lg border-2 border-border bg-card px-3 py-2">
          <input
            type="text"
            readOnly
            value={url}
            className="flex-1 bg-transparent text-sm font-mono outline-none"
            onFocus={(e) => e.currentTarget.select()}
          />
          <CopyButton label="Copy" value={url} />
        </div>
      </section>

      <div className="space-y-3">
        <Button onClick={onStartLobby} className="w-full">
          Start lobby
        </Button>
        <div className="flex justify-center">
          <button
            type="button"
            onClick={onBack}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Back to config
          </button>
        </div>
      </div>
    </div>
  );
}
