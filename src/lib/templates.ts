import type { VotingTemplate } from "@/types";

export const VOTING_TEMPLATES: VotingTemplate[] = [
  {
    id: "classic",
    name: "The Classic",
    description: "For fans who want to be fair and thorough.",
    categories: [
      { name: "Vocals", weight: 1, hint: "Technical delivery and control — not just whether you like the style" },
      { name: "Music", weight: 1, hint: "Composition, arrangement, and production quality" },
      { name: "Outfit", weight: 1, hint: "The look. Does it serve? Does it commit?" },
      { name: "Stage performance", weight: 1, hint: "Movement, energy, use of the stage" },
      { name: "Vibes", weight: 1, hint: "The ineffable. How did it make you feel?" },
    ],
  },
  {
    id: "spectacle",
    name: "The Spectacle",
    description: "For when you want to reward the unhinged.",
    categories: [
      { name: "Drama", weight: 1, hint: "How much did it make you gasp, clutch pearls, or lean forward?" },
      { name: "Costume commitment", weight: 1, hint: "Not just nice — how hard did they go? Full send?" },
      { name: "Staging chaos", weight: 1, hint: "Was it controlled insanity or just confused? Reward the former." },
      { name: "Gay panic level", weight: 1, hint: "The campness. The queerness. The iconography." },
      { name: "Quotability", weight: 1, hint: "Will you still be referencing this in November?" },
    ],
  },
  {
    id: "banger",
    name: "The Banger Test",
    description: "For when the group wants to find the actual best song.",
    categories: [
      { name: "Catchiness", weight: 1, hint: "Could you hum it 10 minutes later?" },
      { name: "Danceability", weight: 1, hint: "Did your body move involuntarily?" },
      { name: "Production", weight: 1, hint: "Sound design, mixing, studio quality" },
      { name: "Lyrics", weight: 1, hint: "What are they actually saying? Does it hold up?" },
      { name: "Originality", weight: 1, hint: "Has Eurovision heard this before?" },
    ],
  },
  {
    id: "custom",
    name: "Custom",
    description: "Build your own categories from scratch.",
    categories: [],
  },
];
