# Custom template — creation wizard (scoped MVP) — design

**Date:** 2026-05-13
**TODO refs:** [TODO.md:191](../../../TODO.md#L191) (Phase U §7.2 custom builder — V1.1), [TODO.md:192](../../../TODO.md#L192) (Phase U §7.2 percentage label — V1.1)
**SPEC ref:** §6.1 Step 2 (template picker), §7.2 (Custom category builder)
**Slice:** Adds a lean, weight-1-only "Custom" option to the create-room wizard. Strict subset of SPEC §7.2: no per-row weight controls, no drag-handle reorder, no percentage display, no custom hints. Lobby-edit explicitly excluded — wizard-only.

## Problem

The wizard at `/create` filters Custom out of the template grid ([VotingConfig.tsx:52](../../../src/components/create/VotingConfig.tsx#L52)). Admins are stuck with three predefined templates (Classic, Spectacle, Banger Test). The full SPEC §7.2 custom builder ([TODO.md:191](../../../TODO.md#L191)) is V1.1 — it bundles drag-handle reorder, integer weight inputs (1–5), percentage-as-primary display, duplicate-name validation, optional hints, and touch-and-hold mobile drag. That's a big slice.

This design ships the **smallest useful subset** of §7.2: admins can name their own 1–8 categories. Every category implicit `weight: 1`. The voting card, scoring engine, and results page need no changes — they already handle uniform-weight rooms (the only difference from a predefined template is that the names are admin-typed).

## Goals

- Custom is selectable as the 4th template in the wizard's grid, alongside Classic / Spectacle / Banger Test.
- Selecting Custom unlocks an inline editor with 1–8 rows. Each row is a single text input for the category name.
- Each row's `weight` is hardcoded to `1` (no UI control).
- Per-row inline validation: empty name, invalid characters, case-insensitive duplicate name within the same room.
- Create button stays disabled while any row is invalid OR fewer than 1 / more than 8 rows exist.
- Server-side `validateCategories` is the final gate. Existing rules ([validateCategories.ts](../../../src/lib/rooms/validateCategories.ts)) already accept this shape exactly.
- Existing predefined-template flow is untouched.

## Non-goals

- **Per-row weight controls.** SPEC §7.2 calls for integer 1–5 weights with a percentage-as-primary display. Deferred to the V1.1 build of [TODO.md:191](../../../TODO.md#L191).
- **Drag-handle reorder.** Row order is the order rows were added; admins can remove + re-add to reorder. Drag-handles + 300ms touch-and-hold deferred to V1.1.
- **Custom hints.** No per-row "Add hint" affordance. The `<TemplateCard>` ⓘ icon is suppressed on Custom rows since no hint exists. Voters see the bare category name as the prompt. Most jokey custom names ("Sweden Bias", "Best Looks") don't need hint text anyway.
- **Lobby-edit reach.** `<LobbyView>`'s template picker continues to show only the three predefined templates. An admin who picked Custom in the wizard sees their custom categories rendered in the lobby preview (existing `<CategoriesPreview>` already supports arbitrary `VotingCategory[]`) but cannot edit them mid-lobby. To change categories, they recreate the room. Adding inline editing to lobby-edit multiplies the QA matrix for marginal value — separate slice.
- **Schema / API / realtime changes.** Pure frontend. The existing `POST /api/rooms` body shape already accepts `categories: VotingCategory[]` with `{name, weight, hint?}`. The server's [validateCategories.ts](../../../src/lib/rooms/validateCategories.ts) already enforces 1–8 categories, the name regex, weight 1–5 default 1, and the duplicate-name rule.

## Architecture

Single wizard surface. Two new files plus three edits in existing ones.

### 1. `<CustomTemplateCard>` component

`src/components/create/CustomTemplateCard.tsx`. Same outer shell as `<TemplateCard>` (border, selected ring, click-to-select target). The ⓘ icon is **suppressed** on Custom — predefined cards use ⓘ to peek at the categories list; on Custom there is no list to peek at until the admin starts typing, and the editor itself appears automatically on selection. The card's "click to select" affordance is the only interaction.

Inside the expanded body when selected:

```
┌─ Card outer (mirrors <TemplateCard>) ───────────────────┐
│  Name + description (collapsed view)                    │
│  ─────── if selected ────────────                       │
│  Your categories                            {n}/8       │
│                                                         │
│  [name input ........................]  [🗑]            │
│   ⚠ Already in your list                                │
│                                                         │
│  [name input ........................]  [🗑]            │
│                                                         │
│  + Add category                                         │
└─────────────────────────────────────────────────────────┘
```

Props:

```ts
interface CustomTemplateCardProps {
  selected: boolean;
  customCategories: string[];        // controlled
  onSelect: () => void;
  onChange: (next: string[]) => void;
}
```

The editor body is rendered only when `selected === true`; when collapsed the card looks identical to a predefined card with name + description only.

### 2. `<CustomCategoryRow>` (inline in `CustomTemplateCard.tsx`)

Per-row layout:

```
[text input — "Category name"]   [trash icon]
[inline error message — when invalid]
```

Behaviour:

- Input value flows up via `onChange(rowIndex, newValue)` to the parent.
- Client-side regex on input: `/^[A-Za-z0-9 \-]{0,24}$/` — same character set as the server regex, but the 2-char floor is relaxed during mid-type (the floor applies on validation, not on each keystroke). Characters outside the set are silently rejected on input (i.e. the input value never contains them).
- Trash button calls `onRemove(rowIndex)`. Disabled when `customCategories.length === 1` — the floor is 1.
- Inline error string is computed by a pure helper `validateCustomRow(value: string, allValues: string[], rowIndex: number): string | null`:
  - `value.trim().length === 0` → `"Add a name"`
  - `value.trim().length < 2` → `"At least 2 characters"`
  - Otherwise (length is fine, charset already enforced) — check duplicate: any other index `j !== rowIndex` where `allValues[j].trim().toLowerCase() === value.trim().toLowerCase()` → `"Already in your list"`
  - Otherwise → `null`

### 3. State + validation in `<CreateRoomPage>`

Add:

```ts
const [customCategories, setCustomCategories] = useState<string[]>([""]);
```

(One blank starter row.)

Derived submit-validity:

```ts
function isCustomValid(rows: string[]): boolean {
  if (rows.length < 1 || rows.length > 8) return false;
  const trimmed = rows.map(r => r.trim().toLowerCase());
  if (new Set(trimmed).size !== trimmed.length) return false;
  return rows.every(r => /^[A-Za-z0-9 \-]{2,24}$/.test(r.trim()));
}

const submitEnabled =
  submitState.kind !== "submitting" &&
  (templateId !== "custom" || isCustomValid(customCategories));
```

On `handleSubmit`, when `templateId === "custom"`:

```ts
categories = customCategories.map(name => ({ name: name.trim(), weight: 1 }));
```

Otherwise the existing branch (`template.categories`) runs unchanged.

### 4. `<VotingConfig>` wiring

Two edits in `src/components/create/VotingConfig.tsx`:

- Remove `.filter((t) => t.id !== "custom")` (line 52). Show all 4 templates.
- Branch the map: predefined IDs render `<TemplateCard>` as today; the `custom` entry renders `<CustomTemplateCard>` with `customCategories` + `onChange` plumbed from the parent.

Two edits in `src/app/create/page.tsx`:

- Widen `TemplateId` from `"classic" | "spectacle" | "bangerTest"` to `... | "custom"`.
- Add `customCategories` state + plumb through to `<VotingConfig>` as props.
- In `handleSubmit`, branch on `templateId === "custom"` to build categories from `customCategories` instead of looking up `template.categories`.

### 5. Locale keys

Additions to `src/locales/en.json` under `create.votingConfig`:

```jsonc
"custom": {
  "yourCategoriesHeading": "Your categories",
  "rowCountLabel": "{n}/8 categories",
  "namePlaceholder": "Category name",
  "addCategoryButton": "+ Add category",
  "removeAria": "Remove category {n}",
  "errors": {
    "empty": "Add a name",
    "tooShort": "At least 2 characters",
    "duplicate": "Already in your list"
  }
}
```

Plus translations for the same keys in `es.json`, `uk.json`, `fr.json`, `de.json` to keep `locales.test.ts` green.

The existing `templates.custom.{name, description}` keys ([locales/en.json:templates.custom](../../../src/locales/en.json)) are already populated across all 5 locales — no edits there.

## Data flow

```
[name input] → onChange(index, value) → parent state customCategories[]
                                          │
                                          ↓
                                   isCustomValid(rows)
                                          │
                                          ↓
                                   Create button enabled/disabled
                                          │
                                          ↓ click
                              handleSubmit() builds
                              categories = rows.map(n => ({name, weight: 1}))
                                          │
                                          ↓ POST /api/rooms
                              createRoom → validateCategories (server)
                              → INSERT rooms row with categories JSONB
                                          │
                                          ↓
                              router.push(`/room/${room.id}`)
```

No new endpoints. No new database columns. No realtime event variants.

## Edge cases

- **Admin types 1 character, tabs out, comes back.** Row shows "At least 2 characters". Create disabled. Adding a second character clears the error.
- **Admin pastes 30-character string.** Input regex caps the value at 24 chars — characters past 24 don't make it into state.
- **Admin pastes emoji or non-Latin script.** Input regex strips invalid characters character-by-character — the input value never contains them. No noisy error; the admin sees the input simply doesn't accept that key.
- **Admin types "Vocals" in row 1, "vocals" in row 2.** Row 2 shows "Already in your list" (case-insensitive trim-match). Row 1 stays clean (duplicate marker only on the later row). If row 1 changes, row 2's duplicate marker should re-evaluate against the new value of row 1 — this fall-out from the controlled-input pattern: the parent re-derives validity on every state change, and `<CustomCategoryRow>` reads `allValues` from the parent on every render.
- **Admin reaches 8 rows.** `+ Add category` is `disabled` with `aria-disabled="true"`. Removing any row re-enables.
- **Admin removes all rows.** Floor is 1 — the last trash button is disabled. Worst case the admin can clear the single input but the row stays present.
- **Admin switches Custom → Classic → Custom.** Their typed rows persist in state across the template switch (state is held in the page, not torn down on selection change). Re-selecting Custom shows the editor exactly where they left it.
- **Admin tries to submit with whitespace-only rows.** `trim()` reduces to empty → row shows "Add a name" → Create disabled. Defence in depth: server `validateCategories` would reject too.
- **Server returns 400 INVALID_CATEGORIES anyway.** Existing `mapCreateError` toast surfaces it; the admin sees the error in the wizard footer (the same path predefined-template errors take today).

## Testing

### Unit / RTL (vitest, jsdom)

- `src/components/create/CustomTemplateCard.test.tsx` — new. RTL cases:
  - Starter render: 1 row visible (empty input), `+ Add category` enabled, trash disabled (only-row floor).
  - Typing into row 1 updates state via the `onChange` callback.
  - Click `+ Add category` → 2 rows; click 7 more → 8 rows; button now `aria-disabled` (or `disabled`).
  - Remove a row from 8 → 7 rows; button re-enabled.
  - Two rows with same value (case-insensitive) → second row renders the duplicate error; first row stays clean.
  - Whitespace-only value → empty-name error.
  - Single-character value → too-short error.
  - Non-`[A-Za-z0-9 -]` keystroke (e.g. paste an emoji) → input value remains valid (the character isn't stored).
  - When `selected === false`, editor body is not rendered (only name + description visible).

- `src/components/create/VotingConfig.test.tsx` — extend with:
  - Custom card appears in the grid (the previous `.filter` is gone).
  - Selecting Custom + valid rows → `submitEnabled` is true.
  - Selecting Custom + any invalid row → `submitEnabled` is false.

- `src/app/create/page.test.tsx` — likely already covers the predefined-template submit path. Add (if absent) a case: when `templateId === "custom"` and `customCategories === ["Vocals", "Drama"]`, the POST body's `categories` field equals `[{name: "Vocals", weight: 1}, {name: "Drama", weight: 1}]`.

### Playwright (chromium, single window)

New file: `tests/e2e/create-custom-template.spec.ts`. Three cases, all `page.route()`-mocked (no seed-room, no realtime):

1. **`Custom template selection expands the inline editor with 1 starter row`**
   - Mock `GET /api/contestants?...` to return a valid preview.
   - Navigate to `/create`, advance to step 2.
   - Click the Custom template card.
   - Assert: 1 row visible (empty input), `+ Add category` enabled, trash disabled.

2. **`Adding rows up to 8 disables the Add button; removing re-enables`**
   - Same setup. Click `+ Add category` 7 times.
   - Assert: 8 rows present, `+ Add` is `aria-disabled` (or `[disabled]`).
   - Remove one row. Assert: 7 rows, `+ Add` re-enabled.

3. **`Submitting Custom with valid rows POSTs the entered names with weight=1`**
   - Capture `POST /api/rooms` body via `page.route('**/api/rooms', async route => { capturedBody = route.request().postDataJSON(); await route.fulfill({ status: 200, body: JSON.stringify(stubRoomResponse) }); })`.
   - Select Custom, type "Vocals" in row 1, click `+ Add category`, type "Stage Drama" in row 2.
   - Click Create.
   - Assert: `capturedBody.categories === [{name: "Vocals", weight: 1}, {name: "Stage Drama", weight: 1}]`.

Vitest covers per-row invalid-character / duplicate / whitespace edge cases at the component level; Playwright is intentionally narrow — happy path + count boundary + POST payload integrity.

### Pre-push verification (mandatory)

Before pushing the branch, the implementation plan's verification task MUST run **both** suites in order and assert pass counts:

1. `npm test` — expect ALL vitest cases pass (1708 baseline + ~10 new from this slice).
2. `npx playwright test` — expect ALL Playwright cases pass (the existing 6 L1 cases + 3 new from this slice = 9 total minimum). Cold first run may need 2–3 minutes for Next.js compile; warm runs <30s.

If either suite has a non-passing case, the verification task halts and reports; no push.

## Files touched

- **Create:**
  - `src/components/create/CustomTemplateCard.tsx`
  - `src/components/create/CustomTemplateCard.test.tsx`
  - `tests/e2e/create-custom-template.spec.ts`
- **Modify:**
  - `src/components/create/VotingConfig.tsx` — drop the custom filter, branch the map between `<TemplateCard>` and `<CustomTemplateCard>`, plumb props
  - `src/components/create/VotingConfig.test.tsx` — extend with custom-card cases
  - `src/app/create/page.tsx` — widen `TemplateId`, add `customCategories` state, branch in `handleSubmit`
  - `src/locales/{en,es,uk,fr,de}.json` — add `create.votingConfig.custom.*` keys (5 strings + 3 error variants)
- **Unchanged:**
  - `src/lib/templates.ts` (custom entry already present with `categories: []`)
  - `src/lib/rooms/validateCategories.ts` (server-side validation already accepts the shape)
  - `src/lib/rooms/createRoom.ts` (no new branches; the existing `categories` field is what we already pass)
  - `supabase/schema.sql` (no schema change)
  - Any API route
  - Realtime payloads

## Rollback notes

Pure frontend change. If a regression surfaces post-merge, revert the single PR; the only server-visible delta is the shape of `categories` in the POST body, which the existing validator handles identically for hand-typed names and predefined-template names. No data migration needed.
