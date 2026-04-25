export interface QueueOverflowBannerProps {
  visible: boolean;
}

/**
 * Sticky banner shown while the offline queue is at its 200-entry cap.
 * SPEC §8.5.3. Uses destructive token (red) to distinguish from the
 * accent-pink offline banner — this is "data loss is happening" severity.
 */
export default function QueueOverflowBanner({
  visible,
}: QueueOverflowBannerProps) {
  if (!visible) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky top-2 mx-4 z-10 rounded-lg border border-destructive/30 bg-destructive/10 text-destructive text-center px-4 py-2 text-sm font-medium backdrop-blur-sm"
    >
      Too many offline changes — oldest may be lost. Reconnect to save.
    </div>
  );
}
