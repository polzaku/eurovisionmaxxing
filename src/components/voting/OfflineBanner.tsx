export interface OfflineBannerProps {
  visible: boolean;
}

/**
 * Sticky top-of-screen banner shown when the browser is offline.
 * SPEC §8.5 copy: "You're offline — changes will sync when you reconnect."
 */
export default function OfflineBanner({ visible }: OfflineBannerProps) {
  if (!visible) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky top-0 z-10 w-full bg-accent text-accent-foreground text-center px-4 py-2 text-sm font-medium"
    >
      You&rsquo;re offline — changes will sync when you reconnect.
    </div>
  );
}
