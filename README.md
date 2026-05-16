# eurovisionmaxxing

> The group-chat way to watch Eurovision.

A mobile-web-first watch-party voting app for the Eurovision Song Contest. A group of friends joins a shared room, scores each performance across the categories of their choice, and ends the night with a proper jury-style 12-points reveal.

**Live:** [eurovisionmaxxing.com](https://eurovisionmaxxing.com)

---

## What it does

- **Rooms** — host creates a room, friends join via PIN or QR. 3–15 people on phones, one TV.
- **Voting** — score each country across configurable categories (Vocals, Outfit, Drama, Vibes, etc.). Pick a preset (*The Classic*, *The Spectacle*, *The Banger Test*) or build your own.
- **Hot takes** — one-liner per country, group-chat style.
- **Reveal** — Eurovision-style live announcement on a TV-friendly `/present` screen, with two modes (full 1→12 per announcer, or short 12-points-only).
- **Awards** — personality stats at the end (*biggest stan*, *harshest critic*, *most contrarian*, …).
- **Europe comparison** — see how your group's ranking diverged from the actual jury + televote results.
- **Languages** — English, Español, Українська, Français, Deutsch.
- **TV-friendly** — `/room/{id}/present` is designed to be AirPlayed or screen-mirrored. ThemeToggle, LocaleSwitcher, and the site footer hide on `/present` so nothing burns into the broadcast.

---

## Tech stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router) + TypeScript strict |
| Styling | Tailwind CSS, dark-first |
| i18n | `next-intl`, cookie-driven locale (5 languages) |
| Database | Supabase Postgres, RLS-enabled |
| Realtime | Supabase Realtime broadcast channels |
| Auth | Anonymous — UUID in localStorage |
| Hosting | Vercel + Cloudflare DNS |
| Tests | Vitest + React Testing Library (jsdom) + Playwright |

All writes go through `/api/*` routes (the Supabase service-role key stays server-side). RLS is defence-in-depth.

---

## Local development

```bash
npm install
cp .env.local.example .env.local      # fill in Supabase keys
npm run dev                            # → http://localhost:3000
```

Supabase setup (one-time, ~5 min): see [SUPABASE_SETUP.md](SUPABASE_SETUP.md).

Useful scripts:

| Command | What it does |
|---|---|
| `npm run dev` | Dev server with hot reload |
| `npm run type-check` | `tsc --noEmit` |
| `npm run lint` | ESLint via `next lint` |
| `npm test` | Vitest run (unit + RTL) |
| `npm run test:e2e` | Playwright (install chromium first via `test:e2e:install`) |
| `npm run build` | Production build |
| `npm run pre-push` | type-check + lint + test + build (wired as a git pre-push hook) |
| `npm run seed:room` | Seed a fixture room into your local DB |
| `npm run fetch-contestants` | Refresh `data/contestants/{year}/{event}.json` from EurovisionAPI |

---

## Project layout

```
src/
  app/                 # Next.js App Router pages + API routes
    api/               # All server-side writes live here
    room/[id]/         # Lobby, voting, announcing, present (TV) surfaces
    results/[id]/      # Post-show results + awards
    about | privacy | terms        # Static legal pages
  components/          # React components, organised by surface
  i18n/                # next-intl wiring (cookie locale, deep-merge fallback)
  lib/                 # Pure logic — scoring, results, realtime, supabase clients
  locales/{en,es,uk,fr,de}.json    # All UI strings
data/contestants/      # Hardcoded fallback JSON per year/event
supabase/schema.sql    # Database schema (run via Supabase SQL Editor)
docs/                  # Internal docs (specs, audits)
```

`SPEC.md` is the source of truth for product + engineering decisions. `CLAUDE.md` documents conventions for AI-assisted contributions.

---

## License

Source under [**Business Source License 1.1**](LICENSE) — read, modify, self-host for personal/non-commercial use freely. Operating it as a paid hosted service that competes with the maintainer's offering is reserved until the **Change Date (2030-05-16)**, after which the work auto-converts to **Apache License 2.0**.

In plain English: fork it, run it for your own Eurovision party, contribute back. Don't spin up a competing paid SaaS.

---

## Contributing

Issues and PRs welcome. Conventions:

- TDD on anything under `src/lib/` and any `/api/*/route.ts` handler.
- RTL component tests for new or substantially-modified `.tsx` files (jsdom env, per SPEC §17a.5).
- `npm run pre-push` must be green before opening a PR.
- See [CLAUDE.md](CLAUDE.md) for the full agent-facing conventions (style, realtime, secrets, etc.).

---

## Legal & contact

- [Privacy policy](https://eurovisionmaxxing.com/privacy)
- [Terms of use](https://eurovisionmaxxing.com/terms)
- Contact: `contact@eurovisionmaxxing.com`

Unaffiliated fan project. Eurovision® and the Eurovision Song Contest® are trademarks of the European Broadcasting Union.
