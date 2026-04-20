"use client";

interface CategoriesPreviewProps {
  categories: Array<{ name: string }>;
}

/**
 * Lobby-side sneak peek of what categories this room will vote on.
 * Names only — hints live on the voting card itself, where they're
 * contextually useful next to the 1-10 buttons.
 */
export default function CategoriesPreview({
  categories,
}: CategoriesPreviewProps) {
  if (categories.length === 0) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-sm uppercase tracking-wider text-muted-foreground">
        You&rsquo;ll be rating
      </h2>
      <ul className="flex flex-wrap gap-2">
        {categories.map((c) => (
          <li
            key={c.name}
            className="rounded-full border border-border bg-card px-3 py-1 text-sm"
          >
            {c.name}
          </li>
        ))}
      </ul>
    </section>
  );
}
