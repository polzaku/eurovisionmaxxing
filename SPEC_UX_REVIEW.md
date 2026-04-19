# SPEC.md — UX/UI review (MVP pass)

> A structured critique of the voting, live event, and admin/host flows in `SPEC.md` as of 2026-04-19. Reviewed against the `design:design-critique` and `design:ux-copy` skill frameworks. Accessibility is *not* in scope for this pass (explicitly excluded); a follow-up `design:accessibility-review` pass is recommended before ship.
>
> ## Status (2026-04-19, round 2 — all proposed edits applied)
>
> **Everything in §4 (punch list) and §5 (proposed SPEC edits) that touches the spec has now landed in `SPEC.md`.** This document is retained as the rationale record; `SPEC.md` is the source of truth going forward.
>
> **Round 1 (three explicit decisions):**
> - **Voting input: slider → 10-button grid.** §7.3, §8.1, §8.2, §3.2 rewritten. Supersedes V1/V2/V3/V4.
> - **Neighbourhood voters / joint winners (L15).** §11.2 + §11.3 specify dual-avatar card; §13 `room_awards` gained `winner_user_id_b` for pair/2-way-tie storage (3+ way ties → top two alphabetically, documented MVP limitation); §19 open question removed.
> - **Custom category builder (A5/A6/A7/A8).** §7.2 rewritten: integer weights 1–5, percentage as primary label, inline hints, grip-handle drag, duplicate-name validation.
>
> **Round 2 (apply-all across remaining punch list):**
> - **§5.2 — Announcement flow.** §10.2 rewritten with an explicit three-surface matrix (Announcer's phone / Present TV / Other guests' phones), tap-anywhere reveal zone, handoff semantics (`rooms.delegate_user_id` column added in §13; points still belong to original announcer), roster of who-has-announced, rejoin rule. §10.3 added iOS Safari fullscreen fallback. §11.3 makes Next always visible and documents post-awards CTAs.
> - **§5.4 — Inline "missed" toast.** §8.3 replaces the modal with an inline toast + undo.
> - **§5.5 — Hot-take counter.** §8.7 adds a live count of hot-take submissions this category and a new placeholder copy line.
> - **§5.6 — Reduced motion.** §3.3 added; gates slide/pop/pulse animations behind `prefers-reduced-motion`.
> - **Remaining voting punch list.** §8.1 separated scored-categories counter from countries-done counter; §8.4 added projection update animation; §8.5 split the save chip into three states (Saved / Saving… / Offline — retrying) with offline queue UX; §8.6 constrains swipe gesture to non-button areas.
> - **Remaining live-event punch list.** §10.1 locks the leaderboard during the 5-minute window and offers a "Reveal anyway" confirm; §10.3 fullscreen iOS fallback (above).
> - **Remaining admin/host punch list.** §6.1 template preview cards, mode cards, rename of "Voting mode" toggle, explicit error CTA, edit-in-lobby, copy-toasts, QR ≥256px; §6.3 Tallying overlay; §6.4 six-slot PIN input; §6.5 deferred snap behaviour + suppressed "now performing" indicator after manual navigation.
> - **Cross-cutting.** Avatar carousel instead of paginated grid (§4.1); avatar-first rejoin flow + create-new escape (§4.3); reduced-motion gating (§3.3, above); `delegate_user_id` schema migration noted in §13 and in `TODO.md`.
>
> **Input:** `SPEC.md` (now ~1,050 lines). No mockups were reviewed — findings are derived from described flows, so pixel-level issues are out of scope and may surface when wireframes exist. An `design:accessibility-review` pass is still recommended before ship.

---

## 1. Overall impression

The spec is unusually tight for an MVP — it's already made most of the hard calls (single source of truth for state on the server, stable category keys under localization, explicit tiebreakers, deterministic present-screen locale). What's missing is **interaction fidelity** in the moments that carry the experience: the slider, the "missed" affordance, the live announcement choreography, and the admin's setup path. These are the moments where the app is used under real-time pressure (friends shouting, TV playing, phones in hand), and the current spec under-specifies them in ways that will either produce arbitrary implementation choices or user-visible confusion during a live event.

**Biggest opportunity:** tighten the three high-stakes interaction loops below (§3), and the rest of the punch list in §4 will mostly be mechanical edits.

---

## 2. Method

Framework applied: first-impression → usability → hierarchy → consistency → copy (abbreviated since no visuals).

For each focus area I looked for: ambiguity that forces the implementer to guess, moments of state the user can't see, contradictions between sections, and copy that is clever but unclear.

Three deep-dives (§3) cover the highest-impact issues — one from each focus area the user chose. The full punch list (§4) covers everything else.

---

## 3. Top 3 deep-dives

### 3.1 The voting slider's mental model is inconsistent and ambiguous (§7.3 + §8.2 + §8.3)

**Where it hurts:** the slider is the single interaction a user repeats 17–26 times per room. Any friction compounds. Right now the spec has three tightly-coupled contradictions:

1. **Anchor count disagrees between sections.** §7.3 declares three anchors (1, 5, 10) with explicit copy for each. §8.2 says "Anchor labels shown at 1 and 10 (small, muted)." Which is it? If 5 is the "Fine. Watched it. Won't remember it." anchor, it's the most important copy in the whole app because it's where users default. Dropping it silently is a loss.

2. **"Unset" visual state is described but not defined.** §8.2: *"On first load, slider starts unset (no default value, shown as a distinct 'not yet scored' state)."* "Distinct" is doing a lot of work here. What does the user actually see? A greyed-out thumb? No thumb at all? A dashed track? Until that's nailed, the "progress indicator: scored/total" in §8.1 is also undefined (when does a category *count* as scored?).

3. **"Snap to 5" on first interaction fights intent.** §8.2: *"Once touched, slider snaps to 5 as starting position and tracks touch normally."* On a touch device, "touching" a slider typically happens *at the place you want to land*, not at the far left. So if I drag at position 3 wanting a 3, the thumb jumps to 5 and then tracks my finger — but my finger is already past the neutral midpoint, so I overshoot or have to lift and re-touch. This is a subtle but real input-latency problem.

   Worse: "scored" is defined as "the slider has been moved once." If the user taps at 5 and doesn't drag, is it scored? If they drag to 5 and release, was that "moved"? This matters because it decides whether §8.1's progress indicator says *"5 of 17"* or *"6 of 17."*

**Why it's a big deal:** these three issues compound. The user doesn't know if they've scored something (unset state undefined), can't hit the value they wanted on the first try (snap to 5), and the anchor that would orient them (5 = Fine) may or may not be shown. During a live broadcast with the next country starting in 90 seconds, all of this friction is amplified.

**Recommended resolution:**

- **Decide on three anchors (1 / 5 / 10) shown always.** Muted, small, below the track. 5 is where everyone starts — surface its copy there.
- **Define the unset state concretely.** Suggestion: slider thumb is absent, track is rendered in `bg-muted` (no filled portion), and a small ghost label reads "tap anywhere to score." When the user taps, the thumb appears at the tap location with `animate-score-pop`.
- **Change "snap to 5" to "land on tap."** First touch places the thumb at the tap x-coordinate (rounded to nearest integer), not at 5. This matches every native iOS slider and eliminates the overshoot problem. Keep §7.3's copy ("5 — Fine. Watched it.") as the label under the 5-tick; that's how users learn the neutral point, not by being forced there.
- **Redefine "scored":** a category is scored when a value has been committed (tap-and-release, or drag-and-release, or explicit button). Pure hover doesn't count. This removes ambiguity from the progress indicator.

See §5.1 for the proposed SPEC.md edit.

---

### 3.2 The live announcement flow has unowned screens and unclear focus (§10.2)

**Where it hurts:** the announcement is the payoff for the whole evening. The spec describes it in linear steps but doesn't answer "what does each screen show at each moment, and who drives?" Four related ambiguities:

1. **The announcer's screen vs. the TV vs. the guests' phones — three surfaces, partially specified.** §10.2 step 3 says *"Announcer's screen shows: '[N] point(s) go to... [Country]' + Next button"* and *"All other screens (+ the present screen) show the leaderboard updating live."* Two gaps:
   - Does the announcer's screen *also* show the leaderboard below the reveal, so they can see the effect of their reveal? Without it, the announcer narrates in the dark.
   - Does the announcer's screen show their **remaining** points (e.g. "still to give: 7, 8, 10, 12") so they know what's next? Without it, they tap Next and hope.

2. **The "Next" button is misaligned with the social moment.** The announcer is *performing* — narrating aloud in character. Tapping a button between beats breaks the flow. On stage, the TV host says "Ukraine, twelve points!" and the points appear. In this app, the announcer has to look down at their phone, find the Next button, and tap. If they're bad at it, the room waits in silence while they fumble. Consider: auto-advance 1.5s after reveal, with a manual "hold" if the announcer wants to pause. Or: a single large tap-anywhere zone instead of a targeted button.

3. **Handoff mid-announcement is underspecified.** §10.2 step 6: *"Admin can tap 'Announce for [User]' to take over for someone who left — admin reads their points aloud."* What state transitions?
   - Does `rooms.announcing_user_id` change to admin? If yes, does that break the "random user order" guarantee (admin was probably not the next scheduled announcer)?
   - If the user returns mid-admin-reveal, can they take back? (Probably not for MVP, but worth stating.)
   - Does the admin see the user's *remaining* points, or do they start fresh? (Must be remaining — otherwise the 12 double-reveal.)

4. **"Who's left?" detection isn't defined.** Admin sees a "Announce for [User]" option — but when is it offered? Based on what signal? Presence timeout? Explicit "I need to step away" button? Without this, admin either sees the option always (and risks a false takeover while the user is in the bathroom) or never (and the room freezes if someone lost reception).

**Why it's a big deal:** this is the single most-mirrored-to-TV moment in the whole app. Any friction plays out in front of every guest. And unlike the voting screen, there's no "try again next country" — the awards are revealed once.

**Recommended resolution:**

- **Define a three-surface matrix** in §10.2 explicitly (proposed in §5.2): announcer's screen, present (TV) screen, guest's phones. For each reveal step, state what's on each.
- **Make Next a tap-anywhere zone on the announcer's screen**, and show remaining points visibly above it. Optional: a subtle 3-second auto-advance with a "Hold" button to pause.
- **Specify handoff semantics.** Suggestion: admin takeover sets a `delegate_user_id` but leaves `announcing_user_id` intact (the points still belong to that user for the record). Leaves user's remaining points untouched; admin continues where they left off.
- **Define the "offer handoff" trigger.** MVP-appropriate: offer handoff to admin after 30 seconds of no "Next" advancement from the current announcer. Always-available as a manual admin action too.

See §5.2 for the proposed SPEC.md edit.

---

### 3.3 Room creation is a one-shot wizard with no preview or recovery (§6.1 + §7.1 + §7.2)

**Where it hurts:** the admin is under time pressure too — the show is starting, friends are joining, they have to pick a template without seeing what categories it generates, and if they pick wrong, the only way back is deleting the room.

Specific gaps:

1. **Templates are described in the spec but not previewable in the UI.** §6.1 step 2 just says *"Select a scoring template (see §7)."* A list of four names ("The Classic", "The Spectacle", "The Banger Test", "Custom") doesn't tell the admin what their friends are about to vote on. The category list + hints should be visible inline before commit — expandable card, not a new page.

2. **"Announcement mode" explained with a short description — but the consequences are huge.** Live vs. Instant is the difference between a 45-minute TV-party experience and a 5-minute summary. The description needs to be more than "a short description" — it should show the user what they're opting into (e.g. "Live: take turns announcing your points, Eurovision-style — great with a TV. Instant: reveal the winner in one shot — great if time is short").

3. **"Now performing" toggle is buried.** §6.1 step 2: *"Toggle: allow 'Now performing' mode."* But §6.5 describes a pretty involved feature — admin panel with contestant list, broadcast snap, guest indicators. A toggle marked *"Now performing"* doesn't convey any of that to a first-time admin. Either rename it something more descriptive ("Let me sync everyone to the currently-performing act") or show a mini-preview of what guests will see.

4. **There's no going back.** §6.1 step 3 is terminal: *"Start lobby" button → transitions room to `lobby` status and navigates admin to room view.* Once in lobby, there's no spec'd path to edit categories, change announcement mode, or switch from semi1 to final because someone just pointed out the user had the wrong event. Since the room is pre-voting, edits should be safe — but the spec has no affordance for them.

5. **Custom category builder has four distinct frictions** (§7.2):
   - **Weight step of 0.5 on mobile is fragile.** Dragging by half-units on a small touch target is frustrating. MVP recommendation: integer-only weights (1–5), step 1. V2 can add 0.5 if real users ask.
   - **Drag-to-reorder + slider coexistence.** Drag gestures on list items on mobile often conflict with horizontal swipes and with slider interactions. Need explicit grip handles + touch-and-hold activation.
   - **Hint is a "tooltip" — but mobile has no hover.** §7.2: *"Hint: optional, max 80 chars, shown as tooltip on the voting card."* On mobile this has to be a tap-to-expand pattern or inline below the category name. "Tooltip" is a desktop metaphor.
   - **No duplicate-name check.** Two categories called "Vocals" would collide in `votes.scores` JSONB. Needs client-side validation + server-side uniqueness check.

**Why it's a big deal:** a botched room creation is how the whole evening goes sideways before the first song. And since the admin is also a guest watching the same live broadcast, they can't spend five minutes recovering from a mistake.

**Recommended resolution:**

- **Make templates previewable inline.** Each template is an expandable card showing its 5 categories + hints before commit.
- **Expand announcement-mode copy.** Two large radio cards with 1–2 lines of plain-language explanation each.
- **Rename "Now performing" toggle** in the UI copy to something like *"Sync everyone to the performing act"* with an optional info icon.
- **Add an "Edit room" path from the lobby.** While status = `lobby`, admin can re-enter a limited wizard (categories, now-performing toggle, announcement mode). Locked once status = `voting`.
- **Custom builder fixes.** Integer weights for MVP. Explicit drag-handle with hold-to-activate. Hints inline below name (not as tooltips). Duplicate-name blocking validation.

See §5.3 for the proposed SPEC.md edit.

---

## 4. Full punch list

Severity: 🔴 Critical (user-visible during live event) · 🟡 Moderate (could be confusing, not blocking) · 🟢 Minor (polish).

### 4.1 Core voting flow (§8)

| # | Severity | Section | Finding | Suggested fix |
|---|---|---|---|---|
| V1 | 🔴 | §7.3 vs §8.2 | Anchor labels: 3 (1/5/10) vs 2 (1/10) — spec contradiction | Reconcile on 3 anchors always shown. See §3.1 / §5.1 |
| V2 | 🔴 | §8.2 | "Unset" state described as "distinct" — not actually defined | Define concretely: no thumb, muted track, ghost "tap to score" label |
| V3 | 🔴 | §8.2 | "Snap to 5 on first touch" causes overshoot on drag-to-a-low-value | Change to "land on tap position" |
| V4 | 🟡 | §8.2 | "Scored" = "moved" — ambiguous for tap-without-drag | Define: scored = value committed on touch release |
| V5 | 🟡 | §8.3 | Modal confirm on "I missed this" interrupts live-viewing flow | Replace with inline undo toast: "Marked missed — undo" |
| V6 | 🟡 | §8.3 | "I missed this" modal copy doesn't preview the estimated value | Show projected score inline in the confirmation affordance |
| V7 | 🟡 | §8.3 | Undo flow for "missed" not specified — how does user come back? | Specify: tap the card or a dedicated "Rescore" button in the missed state |
| V8 | 🟡 | §8.4 | Projected scores update live — confusing when they shift | Option A: freeze projection at mark time; Option B: explicit "updated from your recent votes" tag with animation |
| V9 | 🟡 | §8.5 | "Saving → Saved" fades after 1s; no persistent "all saved" cue | Add persistent "All changes saved" indicator (subtle, always visible) when in sync |
| V10 | 🟡 | §8.5 | No specified offline UX | Add: offline banner + queue outgoing changes; show "Offline — changes will sync" tag |
| V11 | 🟡 | §8.6 | Horizontal swipe to navigate collides with slider drag | Specify: swipes only count on non-slider regions; or: swipe requires a second finger / edge gesture |
| V12 | 🟡 | §6.5 + §8.6 | "Now performing" snap during slider drag | Specify: defer snap until user releases slider |
| V13 | 🟢 | §8.7 | 140-char limit with emoji = 2 chars — invisible rule | Add visible counter; show overrun in red at 120/140 |
| V14 | 🟢 | §8.7 | "Your hot take on this performance..." placeholder is generic | Consider contextual placeholder (first song: "What did you think?"; later: "React to this one...") — or just "Your one-liner" to be shorter |
| V15 | 🟢 | §8.1 | Running order "3 of 17" — clear, but "17" changes after missing | Clarify: total is always #contestants, scored progress separate |

### 4.2 Live event moments (§4, §10, §11)

| # | Severity | Section | Finding | Suggested fix |
|---|---|---|---|---|
| L1 | 🔴 | §10.2 | Three-surface screen matrix not defined | See §3.2 / §5.2 |
| L2 | 🔴 | §10.2 | Announcer "Next" button breaks narration flow | See §3.2 / §5.2 |
| L3 | 🔴 | §10.2 | Handoff mid-announcement — state semantics underspecified | See §3.2 / §5.2 |
| L4 | 🔴 | §10.2 | "Offer handoff" trigger undefined | Specify 30-second inactivity threshold; always-available manual admin action |
| L5 | 🟡 | §4.1 | Avatar "regenerate with random seed" — no back/history | Add: show a small carousel of 4–6 pre-generated seeds; user picks |
| L6 | 🟡 | §4.1 | Avatar re-renders on every keystroke → flashing during typing | Use debounced name only as *initial* seed; avatar stays stable after first render unless user taps to regenerate |
| L7 | 🟡 | §4.3 | "We found [Name] in this room" leaks existing user names to strangers | Require the claimer to also confirm an avatar match; don't reveal display_name text until after avatar pick |
| L8 | 🟡 | §4.3 | Multiple same-name resolution via avatar — unreliable if names were auto-generated | Add a tiebreak "how about last 3 digits of your old user id" or "create new" escape hatch |
| L9 | 🟡 | §6.3 | `scoring` state is <1s but user-visible — what renders? | Spec a brief "Tallying results…" loading screen with `animate-shimmer` |
| L10 | 🟡 | §6.3 | Rejoin during `announcing` — what's the user's entry point? | Specify: land on current leaderboard + announcer label + "Catching up…" for the last reveal |
| L11 | 🟡 | §10.1 | "Ready to reveal" can be blocked by afk user forever | Admin gets a "Reveal anyway" override after N ready or timeout |
| L12 | 🟡 | §10.1 | Users see own results *before* group reveal — dampens the group moment | Consider: own results locked until all-ready or admin unlock; preview is just "your 12 points went to X" without showing the group standings |
| L13 | 🟡 | §10.3 | Present screen PWA `display: standalone` + landscape override — iOS behavior nuanced | Add explicit MVP guardrail: "if standalone/landscape can't be acquired, show a one-tap 'Enter fullscreen' prompt" |
| L14 | 🟡 | §11 | Awards reveal has no explicit skip/pause — if admin fumbles, room watches frozen UI | Add a "Next award" admin button always visible in a corner |
| L15 | 🟡 | §11.3 | "Neighbourhood voters" pair format is the open question in §19 | Resolve before awards UI work: recommend dual-avatar card ("voted most alike: A + B") |
| L16 | 🟢 | §11.3 | No "play again / save" CTA after awards | Add "Create another room" + "Copy share link" at end |
| L17 | 🟢 | §6.4 | PIN input is a "single large field, auto-uppercase, 6-char limit" — no visual slot separation | Use 6 individual slots (like SMS code input) to match how PINs are spoken aloud |
| L18 | 🟢 | §6.2 | PIN charset excludes O/0/I/1 — good; but B/8, S/5, Z/2 also confusable when shouted | Consider dropping these too; down to ~27 chars but still fine for collision probability |

### 4.3 Admin / host flows (§6, §7.2, §10.2)

| # | Severity | Section | Finding | Suggested fix |
|---|---|---|---|---|
| A1 | 🔴 | §6.1 + §7 | Templates not previewable before commit | See §3.3 / §5.3 |
| A2 | 🔴 | §6.1 | No "edit room" path from lobby — one-shot commit | Add edit affordance while status = `lobby`; lock on `voting`. |
| A3 | 🟡 | §6.1 | Announcement mode radio description underspecified | Two plain-language radio cards. See §3.3 |
| A4 | 🟡 | §6.1 + §6.5 | "Now performing" toggle named obscurely | Rename to "Sync everyone to the performing act" with tooltip/info |
| A5 | 🟡 | §7.2 | Weight step 0.5 on mobile is fragile | MVP: integer-only (1–5). Restore 0.5 in V2 if users ask |
| A6 | 🟡 | §7.2 | Drag-to-reorder on mobile needs explicit grip handle | Specify: grip icon on left, touch-and-hold to activate |
| A7 | 🟡 | §7.2 | "Hint" described as tooltip — mobile has no hover | Spec: inline below name, permanently visible; no tooltip pattern |
| A8 | 🟡 | §7.2 | No duplicate-name validation | Add client-side immediate warning + server-side 409 on create |
| A9 | 🟡 | §6.5 | "Now performing" mode snap-on-broadcast — admin has no queue | V2-worthy: auto-follow running order with manual override. MVP: note that admin drives manually each time |
| A10 | 🟡 | §6.5 | Non-admin sees "🎤 Now performing: Country — Song" — but what if already on that card? | Specify: indicator dismisses/suppresses when viewing the performing card |
| A11 | 🟡 | §10.2 | Admin handoff visibility — how does admin see who's active? | Add a small roster with presence dots in the admin control panel |
| A12 | 🟡 | §6.1 | Step 3 "Copy link / Copy PIN" buttons — no confirmation feedback specified | Add toast or inline "Copied!" for 2s |
| A13 | 🟢 | §6.1 | "17 countries loaded" is good — but error state for API+fallback failure? | Spec: inline error with "Try different event" CTA (already hinted in §5.1 step 4, but not wired to the wizard) |
| A14 | 🟢 | §6.1 | QR code is generated but no minimum-size guarantee | Specify: render at ≥256×256 CSS px for reliable scanning across the room |

---

## 5. Proposed SPEC.md edits

> These are proposals only — not applied. Per CLAUDE.md §1, SPEC edits need human approval first. Pasted as before/after for easy review.

### 5.1 §7.3 + §8.2 — slider anchors, unset state, first touch

**Before (§7.3):**

> ### 7.3 Score scale anchors
> All categories use a 1–10 integer scale. Anchor labels shown on the slider:
> - **1** — Devastating. A moment I will try to forget.
> - **5** — Fine. Watched it. Won't remember it.
> - **10** — Absolute masterpiece. My 12 points. Iconic.
>
> These anchors appear on every voting card regardless of template.

**After (§7.3):**

> ### 7.3 Score scale anchors
> All categories use a 1–10 integer scale. **Three** anchor labels appear on every slider (small, muted, below the track):
> - **1** — Devastating. A moment I will try to forget.
> - **5** — Fine. Watched it. Won't remember it.
> - **10** — Absolute masterpiece. My 12 points. Iconic.
>
> These anchors appear on every voting card regardless of template. Anchor copy is translated via `t('voting.anchor1' | 'voting.anchor5' | 'voting.anchor10')`; see §21.

**Before (§8.2):**

> - Anchor labels shown at 1 and 10 (small, muted)
> - On first load, slider starts unset (no default value, shown as a distinct "not yet scored" state)
> - Once touched, slider snaps to 5 as starting position and tracks touch normally
> - A category is "scored" as soon as the slider is moved for the first time

**After (§8.2):**

> - Anchor labels shown at **1, 5, and 10** (small, muted, below the track) — see §7.3
> - On first load, slider is in the **unset state**: no thumb rendered, track in `bg-muted` with no filled portion, and a small ghost label below reading "Tap to score"
> - **First touch lands the thumb at the tapped x-coordinate** (rounded to nearest integer 1–10), with `animate-score-pop` — the slider does *not* snap to 5. Subsequent drags behave normally
> - A category is considered **scored** when a value has been committed (touch/click release on the slider with the thumb in a valid position). Pure hover or mid-drag does not count. The "progress indicator" in §8.1 counts only scored categories per this definition

### 5.2 §10.2 — live announcement screen matrix + handoff

**Before (§10.2 Flow step 3):**

> 3. For each point reveal:
>    - Announcer's screen shows: *"[N] point(s) go to... [Country]"* + Next button
>    - All other screens (+ the present screen) show the leaderboard updating live
>    - A country's score animates upward as points are added — other countries may shift in ranking

**After (§10.2 Flow step 3):**

> 3. For each point reveal, the three surfaces show:
>
>    | Surface | Content |
>    |---|---|
>    | **Announcer's phone** | Top: remaining points to give (e.g. *"Still to give: 7, 8, 10, 12"*). Middle: current reveal *"[N] point(s) go to... [Country]"*. Bottom: full room leaderboard so they can see the effect. Entire screen below the reveal line is a tap-to-advance zone (see below). |
>    | **Present (TV) screen** | Full-screen leaderboard with rank-shift animation as scores update. Label in corner: *"[User] is announcing"*. Current point reveal surfaces as a large overlay that fades after 3s. |
>    | **Other guests' phones** | Live leaderboard (compact). Label: *"[User] is announcing"*. Current reveal shown as a toast. |
>
>    - The announcer advances by **tapping anywhere on the lower half of their screen** (not a small button). Optional auto-advance after 3s of inactivity, with a persistent "Hold" control to pause.
>    - Score animation on the present + guest screens is driven by the `score_update` broadcast event (§15).

**Before (§10.2 Flow step 6):**

> 6. Admin can tap "Announce for [User]" to take over for someone who left — admin reads their points aloud

**After (§10.2 Flow step 6 — new subsection):**

> 6. **Handoff semantics:**
>    - The "Announce for [User]" option appears to the admin when either (a) the current announcer has not advanced within 30 seconds, or (b) the admin explicitly opens the announcer roster panel.
>    - On takeover, `rooms.announcing_user_id` remains the original user (the points still belong to them for the record); a new field `rooms.delegate_user_id` is set to the admin. The admin advances from the current `current_announce_idx` — the user's already-revealed points are not re-revealed.
>    - If the original user returns, they see "Admin is announcing for you" and are *not* offered the UI back for MVP. (V2: restore control.)
>    - `POST /api/rooms/{id}/announce/handoff` sets `delegate_user_id`; `POST /api/rooms/{id}/announce/next` accepts advances from either `announcing_user_id` or `delegate_user_id`.

**(Schema implication:** add `delegate_user_id UUID REFERENCES users(id)` to `rooms` table in §13.**)**

### 5.3 §6.1 + §7.2 — room creation wizard + custom builder

**Before (§6.1 Step 2):**

> **Step 2: Voting configuration**
> - Select a scoring template (see §7)
> - Or build custom categories
> - Set announcement mode: Live or Instant (explained with a short description)
> - Toggle: allow "Now performing" mode (admin can focus all users to current song)

**After (§6.1 Step 2):**

> **Step 2: Voting configuration**
> - Template selection: four cards (Classic / Spectacle / Banger Test / Custom). Each predefined card is expandable to show its categories + hints inline before commit.
> - Announcement mode: two large radio cards with full copy —
>   - **Live:** *"Take turns announcing your points, Eurovision-style. Great with a TV."*
>   - **Instant:** *"Reveal the winner in one shot. Great if you're short on time."*
> - "Sync everyone to the performing act" toggle (previously labelled "Now performing") — lets the admin tap the currently-performing country to bring all guests to that card. Off by default.

**After (§6.1 — new Step 4 edit-in-lobby):**

> **Editing after creation:**
> While the room is in `lobby` status, the admin can re-open a limited wizard (categories, announcement mode, now-performing toggle) via an "Edit room" action. Year/event are **not** editable post-creation (contestant data and PIN don't change). Locked once status transitions to `voting`.

**Before (§7.2):**

> - Each category:
>   - Name: required, 2–24 chars, no special characters
>   - Weight: optional number input, blank = 1, min 0.5, max 5, step 0.5
>   - Hint: optional, max 80 chars, shown as tooltip on the voting card
> - Drag-to-reorder (determines display order on voting card)

**After (§7.2):**

> - Each category:
>   - Name: required, 2–24 chars, no special characters. Duplicate names (case-insensitive, trimmed) within the same room are rejected.
>   - Weight: optional integer input, blank = 1, min 1, max 5, step 1. (Half-unit weights deferred to V2.)
>   - Hint: optional, max 80 chars. Rendered **inline below the category name on the voting card**, permanently visible. Not a hover tooltip.
> - Reorder via a dedicated drag handle (grip icon on the left of each row). Touch-and-hold (300ms) to activate dragging on mobile.

### 5.4 §8.3 — "I missed this" inline replacement for modal

**Before (§8.3):**

> - Tap → modal confirm: *"Mark [Country] as missed? We'll fill in an estimated score based on your average voting across other entries."*
> - On confirm: contestant is marked `missed: true`, card shows a distinct "missed" state with the estimated score displayed as `~7` (with tilde prefix, dimmed/italic)

**After (§8.3):**

> - Tap → contestant is immediately marked `missed: true` (no modal). A toast appears at the bottom: *"Marked missed — we'll estimate your scores as ~[projected average]. Undo"*. The toast's "Undo" reverts within 5 seconds; after that the user can still leave the missed state via a "Rescore" button on the card itself.
> - The estimated average shown in the toast is the user's mean score across their non-missed categories at that moment (rounded to 1dp). Matches the projected-score display in §8.4.

### 5.5 §8.7 — hot-take counter

**Before:**

> - 140 character limit, emoji-aware (emoji count as 2 chars)
> - Placeholder: *"Your hot take on this performance..."*

**After:**

> - 140 character limit, emoji-aware (emoji count as 2 chars). A live counter renders below the input (*"120 / 140"*), turns the accent pink when within 10 of the limit.
> - Placeholder: *"Your one-liner"*

### 5.6 §3 — reduced-motion note (applies to §3.2 animations)

**After (add subsection §3.3):**

> ### 3.3 Reduced motion
>
> All animations in §3.2 are gated by `prefers-reduced-motion: no-preference` at the CSS level. For users with `prefers-reduced-motion: reduce`:
> - `animate-score-pop` is disabled (score updates instantly).
> - `animate-rank-shift` becomes an instant reorder (no transition).
> - `animate-fade-in` becomes an instant opacity flip.
> - `animate-shimmer` is replaced with a static `bg-muted`.

---

## 6. Proposed TODO.md additions

Items that can be started without SPEC changes are marked **[now]**. Items that depend on the SPEC edits above are marked **[after spec]**.

```markdown
## Phase U — UX review follow-ups (SPEC_UX_REVIEW.md)

### Core voting
- [ ] **[after spec]** Update slider component: three-anchor (1/5/10) rendering, unset state (no thumb, "tap to score" ghost label), first-touch lands on tap position (V1/V2/V3)
- [ ] **[after spec]** Redefine "scored" on touch release (not touch-start); update progress indicator accordingly (V4)
- [ ] **[after spec]** Replace "I missed this" modal with inline toast + 5s undo + "Rescore" card button (V5/V6/V7)
- [ ] **[now]** Projected score display: add "updated from your recent votes" animation on change (V8)
- [ ] **[now]** Persistent "All changes saved" indicator when in sync (V9)
- [ ] **[now]** Offline banner + queued-changes UX (V10)
- [ ] **[now]** Swipe-to-navigate only outside slider regions (V11)
- [ ] **[now]** Defer "now performing" snap until slider drag is released (V12)
- [ ] **[now]** Hot-take counter visible; pink near limit; placeholder shortened to "Your one-liner" (V13/V14)

### Live event moments
- [ ] **[after spec]** Three-surface reveal matrix implemented per §10.2 (announcer phone / present TV / guest phones) (L1)
- [ ] **[after spec]** Announcer "tap anywhere lower half" advancement + optional 3s auto-advance with Hold (L2)
- [ ] **[after spec]** Handoff semantics: `rooms.delegate_user_id` field, 30s inactivity trigger, continue from current idx (L3/L4)
- [ ] **[now]** Avatar onboarding: swap keystroke-driven regeneration for a 4–6 preset carousel after initial seed (L5/L6)
- [ ] **[now]** Same-name rejoin: hide display_name text until avatar is picked (privacy) (L7)
- [ ] **[now]** Add "create new" escape hatch in same-name resolver (L8)
- [ ] **[now]** Brief "Tallying results…" loading screen for the `scoring` transition (L9)
- [ ] **[now]** Spec + implement mid-announce rejoin: current leaderboard + "Catching up…" flash (L10)
- [ ] **[now]** Admin "Reveal anyway" override for instant mode after N ready or 60s (L11)
- [ ] **[now]** Instant mode: own-points reveal shows 12→1 one at a time; full leaderboard locked until all-ready / admin unlock (L12)
- [ ] **[now]** Present screen: one-tap "Enter fullscreen" fallback when standalone/landscape fail on iOS Safari (L13)
- [ ] **[now]** Awards: always-visible "Next award" button in corner (L14)
- [ ] **[now]** Resolve "Neighbourhood voters" pair display format (dual-avatar card recommended) — closes SPEC §19 open Q (L15)
- [ ] **[now]** Post-awards: "Create another room" + "Copy share link" CTAs (L16)
- [ ] **[now]** PIN input: 6 individual slot inputs (SMS-code style) (L17)

### Admin / host flows
- [ ] **[after spec]** Room wizard: inline template preview, plain-language announcement mode cards, rename "Now performing" toggle (A1/A3/A4)
- [ ] **[after spec]** "Edit room" path while status = lobby; lock on voting (A2)
- [ ] **[after spec]** Custom category builder: integer-only weights, grip handles with hold-to-drag, hints inline (not tooltip), duplicate-name validation (A5/A6/A7/A8)
- [ ] **[now]** Non-admin "Now performing" indicator suppressed when already on the performing card (A10)
- [ ] **[now]** Admin announcer roster with presence dots (A11)
- [ ] **[now]** "Copied!" toasts for Copy link / Copy PIN buttons (A12)
- [ ] **[now]** Wizard: inline error + "Try different event" CTA when contestant data fails (A13)
- [ ] **[now]** QR code rendered at ≥256×256 CSS px (A14)

### Cross-cutting
- [ ] **[after spec]** Reduced-motion: gate all §3.2 animations on `prefers-reduced-motion` (§5.6 proposed)
- [ ] **[now]** Run `design:accessibility-review` pass on voting + present + awards screens before MVP ship
```

---

## 7. What works well (acknowledge the wins)

Worth calling out since good feedback is balanced:

- **§3.1 palette + semantic tokens.** The CSS-variable + Tailwind-utility discipline is the right call, and CLAUDE.md §3.2's "no hardcoded hex" rule is a sharp enforcement.
- **§9 scoring engine tiebreak cascade.** Peak score → count above 7 → alphabetical is deterministic and intuitive; users will rarely see ties but when they do, nothing feels arbitrary.
- **§21 localization model.** Stable-key-first, display-string-second is how this is supposed to work. The `category.key ?? category.name` vote-resolution rule is exactly right.
- **§10.3 present-screen locale determinism.** Rendering the TV in the admin's locale regardless of who opens the URL is a good call — prevents weird bi-locale chaos on the TV.
- **§11.2 personality awards.** The Hive Mind Master / Most Contrarian pair via Spearman is clever and cheap to compute. The Enabler as closer is narratively strong.
- **§12 UptimeRobot pinging a real query, not just the homepage.** This detail matters and is easy to miss.
- **§6.2 PIN charset.** Excluding O/0/I/1 is the right instinct — just consider going further (B/8, S/5, Z/2).

---

## 8. Next steps (suggested order)

1. **Review this doc.** Tag accept / reject / discuss per item.
2. **Approve SPEC.md edits.** I'll apply the accepted §5 edits to SPEC.md and bump any referenced sections (particularly §13 for the new `delegate_user_id` column).
3. **Accepted TODO items land.** Each accepted item in §6 gets copied into TODO.md under the new Phase U.
4. **Run `design:accessibility-review`** as a separate pass before MVP ship (explicitly deferred in this review).
