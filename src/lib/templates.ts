import type { VotingTemplate } from "@/types";

export const VOTING_TEMPLATES: VotingTemplate[] = [
  {
    id: "classic",
    key: "classic",
    nameKey: "templates.classic.name",
    descriptionKey: "templates.classic.description",
    name: "The Classic",
    description: "For fans who want to be fair and thorough.",
    categories: [
      { key: "vocals",           nameKey: "categories.vocals.name",           hintKey: "categories.vocals.hint",           name: "Vocals",            weight: 1, hint: "Technical delivery and control — not just whether you like the style" },
      { key: "music",            nameKey: "categories.music.name",            hintKey: "categories.music.hint",            name: "Music",             weight: 1, hint: "Composition, arrangement, and production quality" },
      { key: "outfit",           nameKey: "categories.outfit.name",           hintKey: "categories.outfit.hint",           name: "Outfit",            weight: 1, hint: "The look. Does it serve? Does it commit?" },
      { key: "stagePerformance", nameKey: "categories.stagePerformance.name", hintKey: "categories.stagePerformance.hint", name: "Stage performance", weight: 1, hint: "Movement, energy, use of the stage" },
      { key: "vibes",            nameKey: "categories.vibes.name",            hintKey: "categories.vibes.hint",            name: "Vibes",             weight: 1, hint: "The ineffable. How did it make you feel?" },
    ],
  },
  {
    id: "spectacle",
    key: "spectacle",
    nameKey: "templates.spectacle.name",
    descriptionKey: "templates.spectacle.description",
    name: "The Spectacle",
    description: "For when you want to reward the unhinged.",
    categories: [
      { key: "drama",             nameKey: "categories.drama.name",             hintKey: "categories.drama.hint",             name: "Drama",              weight: 1, hint: "How much did it make you gasp, clutch pearls, or lean forward?" },
      { key: "costumeCommitment", nameKey: "categories.costumeCommitment.name", hintKey: "categories.costumeCommitment.hint", name: "Costume commitment", weight: 1, hint: "Not just nice — how hard did they go? Full send?" },
      { key: "stagingChaos",      nameKey: "categories.stagingChaos.name",      hintKey: "categories.stagingChaos.hint",      name: "Staging chaos",      weight: 1, hint: "Was it controlled insanity or just confused? Reward the former." },
      { key: "gayPanicLevel",     nameKey: "categories.gayPanicLevel.name",     hintKey: "categories.gayPanicLevel.hint",     name: "Gay panic level",    weight: 1, hint: "The campness. The queerness. The iconography." },
      { key: "quotability",       nameKey: "categories.quotability.name",       hintKey: "categories.quotability.hint",       name: "Quotability",        weight: 1, hint: "Will you still be referencing this in November?" },
    ],
  },
  {
    id: "bangerTest",
    key: "bangerTest",
    nameKey: "templates.bangerTest.name",
    descriptionKey: "templates.bangerTest.description",
    name: "The Banger Test",
    description: "For when the group wants to find the actual best song.",
    categories: [
      { key: "catchiness",   nameKey: "categories.catchiness.name",   hintKey: "categories.catchiness.hint",   name: "Catchiness",   weight: 1, hint: "Could you hum it 10 minutes later?" },
      { key: "danceability", nameKey: "categories.danceability.name", hintKey: "categories.danceability.hint", name: "Danceability", weight: 1, hint: "Did your body move involuntarily?" },
      { key: "production",   nameKey: "categories.production.name",   hintKey: "categories.production.hint",   name: "Production",   weight: 1, hint: "Sound design, mixing, studio quality" },
      { key: "lyrics",       nameKey: "categories.lyrics.name",       hintKey: "categories.lyrics.hint",       name: "Lyrics",       weight: 1, hint: "What are they actually saying? Does it hold up?" },
      { key: "originality",  nameKey: "categories.originality.name",  hintKey: "categories.originality.hint",  name: "Originality",  weight: 1, hint: "Has Eurovision heard this before?" },
    ],
  },
  {
    id: "custom",
    key: "custom",
    nameKey: "templates.custom.name",
    descriptionKey: "templates.custom.description",
    name: "Custom",
    description: "Build your own categories from scratch.",
    categories: [],
  },
];
