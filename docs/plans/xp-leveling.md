# XP & Leveling System — Plan

Status: DRAFT (planning iteration)
Owner: —
Target pacing: ~1 month to L10 for a regularly-engaged user

---

## Guiding principles

1. **Reward pursuit of greatness, not just persistence.** Curated
   ("learn" route) recipes and course-like progression yield the
   biggest XP. Persistence still levels you, but mastery walks faster.
2. **Always tell the user WHY they got points.** Cook-complete and
   event toasts reveal bonuses sequentially — each bonus surprises,
   lands, settles, then the next one appears. No itemized receipt.
3. **Streaks should feel protected once earned.** Shield schedule
   scales with investment; a 30-day streak is not one bad day from
   zero.
4. **Anti-grind without punishing streaks.** Soft/hard daily caps on
   raw earning, but the fire-mode multiplier applies *after* the cap
   so streak days still feel rewarding at equal effort.
5. **Identity-field hierarchy and reserved palette (see CLAUDE.md)
   are law.** XP UI reuses the existing colors where an axis is
   referenced; no new reserved colors are introduced by this system.
6. **Every tunable number lives in config tables, not in code.**
   Base XP per source, daily caps, streak multiplier schedule,
   curated ladder thresholds, rarity-roll odds, badge-tier XP —
   all stored in `xp_config` (scalars) and dedicated tier tables
   (`xp_streak_tiers`, `xp_curated_ladder`, `xp_rarity_rolls`,
   `xp_badge_tier_xp`). `award_xp()` reads at evaluation time with
   a short-lived cache. Tweaking a value = one UPDATE — no
   migration, no redeploy. All edits are audited in
   `xp_config_audit`.

---

## Table of contents

1. XP sources (master table)
2. Curated-recipe scaling (1.5× → 3×) & level titles
3. Fire mode: streak multiplier & shield schedule
4. Anti-grind: caps & daily login roll
5. Cook-complete toast choreography
6. Data model — what exists vs. what we scaffold
7. Open questions & implementation phases

---

## 1. XP sources (master table)

Base values below are PRE-multiplier. The fire-mode streak multiplier
(§3) and curated-scaling multiplier (§2) apply on top. Anti-grind
caps (§4) trim raw earning before the streak multiplier is applied
(see §4 for the exact ordering).

### Cooking

| Action                                     | XP    | Notes                                                      |
| ------------------------------------------ | ----- | ---------------------------------------------------------- |
| Cook complete (AI/one-off recipe)          | +50   | Base. 1× scaling.                                          |
| Cook complete (user-custom recipe)         | +50   | 1× scaling. `user_recipes.source = 'custom'`.              |
| Cook complete (curated "learn" recipe)     | +50   | Enters the 1.5×→3× ladder (§2).                            |
| First-time cooking ANY recipe              | +100  | Once per `recipe_id` per user. Bundled or custom.          |
| Plan → Cook closed                         | +15   | Scheduled on Plan, cooked at/near that slot.               |
| Eaten together (diner bonus)               | +50   | Meal had ≥2 diners. Capped 3/day (§4).                     |
| Cook-together fulfilled                    | +10   | Requester claimed, cooker cooked. Both parties.            |
| Author's cut (someone cooks your recipe)   | +10   | Capped 3×/recipe total to block 2-account farms.           |
| Per-skill XP on the recipe                 | var.  | Already on bundled recipes (`skills[].xp`). Keep as-is.    |
| Mastery: 5× / 10× / 25× same recipe        | +25 / +75 / +200 | "Dialed In" milestones.                         |

### Curated progression (apex source — see §2 for multiplier)

| Action                                     | XP    | Notes                                                      |
| ------------------------------------------ | ----- | ---------------------------------------------------------- |
| Complete every recipe in a curated set     | +500  | Set = collection tag on "learn" recipes.                   |
| Master a themed collection                 | +1000 | Legendary badge awarded alongside.                         |

### Data contribution

| Action                                     | XP    | Notes                                                      |
| ------------------------------------------ | ----- | ---------------------------------------------------------- |
| Scan barcode / add pantry item             | +5    | Cap 50 XP/day (§4).                                        |
| Photo on a cook                            | +10   | Max 2/cook.                                                |
| Create a canonical (CanonicalCreatePrompt) | +15   | At submission.                                             |
| Canonical approved by admin                | +25   | When `ingredient_info` approval row lands. Retroactive.    |
| Author a new custom recipe                 | +50   | ≥3 steps AND ≥3 ingredients to qualify (anti-spam).        |
| Review a cook (rate/note someone's meal)   | +5    | Cap 3/day.                                                 |
| Nutrition goal day                         | +25   | Hit daily kcal/macros on NutritionDashboard. 1×/day.       |
| Pantry hygiene (mark used / fix qty)       | +2    | Cap 10/day. Rewards the data-quality work.                 |

### Onboarding starter pack (one-time, makes L2-3 snappy)

| Action                                     | XP    |
| ------------------------------------------ | ----- |
| First household                            | +10   |
| First pantry item                          | +10   |
| First cook                                 | +20   |
| First canonical link                       | +15   |
| First plan entry                           | +10   |
| First friend / household member add        | +15   |

### Badges (scaled by rarity — see `badges.tier`)

| Tier       | XP    |
| ---------- | ----- |
| Common     | +50   |
| Uncommon   | +100  |
| Rare       | +250  |
| Legendary  | +500  |

---

## 2. Curated-recipe scaling & level titles

### Curated multiplier ladder

Only `route` includes `"learn"` recipes earn the multiplier. The
ladder is per-user, per-cuisine-or-theme, walked by depth of
engagement in that track. "Lesson" here = one completed cook of a
curated recipe in that cuisine/collection.

| Lessons completed (in cuisine) | Multiplier on base cook XP |
| ------------------------------ | -------------------------- |
| 1-4                            | 1.5×                       |
| 5-9                            | 1.75×                      |
| 10-14                          | 2.0×                       |
| 15-19                          | 2.5×                       |
| 20+                            | 3.0× (max)                 |

Non-curated cooks (AI, custom) stay at 1.0×. The "cuisine" axis
reuses `profiles.cuisines_cooked` + a new `cuisine` tag on the
curated recipes (see §6 for the schema check).

The multiplier applies to:

- Base cook-complete XP
- Per-skill XP on the recipe
- Mastery milestones

It does NOT apply to flat bonuses (first-time, plan→cook closed,
eaten together, photos) — those stay flat so new-cuisine explorers
aren't outpaced.

### Level titles

| Level range | Title          |
| ----------- | -------------- |
| L1-5        | Apprentice     |
| L6-10       | Line Cook      |
| L11-20      | Home Chef      |
| L21-35      | Sous Chef      |
| L36-50      | Head Chef      |
| L51-75      | Executive Chef |
| L76+        | Iron Chef      |

Final "Legend" tier deferred — Iron Chef is the ceiling until we
have real data on how many users reach L76.

### Level curve

Target pacing: ~1 month to L10 for a user cooking 4-5×/week with
scans + a streak. Rough curve (to be tuned after we instrument):

`xp_to_next(L) = round(100 * L^1.6)`

Produces: L1→L2 = 100, L5→L6 ≈ 1,320, L10→L11 ≈ 3,980,
L20→L21 ≈ 12,100, L50→L51 ≈ 61,800. Curated 3× ladder is what
makes L50+ tractable for the dedicated cook without requiring
decades.

---

## 3. Fire mode — streak multiplier & shields

### Streak definition

A "streak day" is any day with ≥1 tracked action: cook, scan, photo,
schedule (plan), review, or pantry-hygiene edit. Bar is intentionally
low so the streak survives a travel day where you only scan
something, but it still has to be an affirmative act (opening the
app doesn't count).

Timezone: user's local day from `profiles.timezone`, not UTC.
Rollover at 04:00 local (gives late-night cooks a cushion).

### Multiplier schedule

Applied AFTER anti-grind caps (§4), so streak days always feel
rewarding at equal effort — the cap limits farming, not loyalty.

| Streak days | Tier    | Multiplier | Visual                            |
| ----------- | ------- | ---------- | --------------------------------- |
| 1-2         | —       | 1.00×      | No flame                          |
| 3-6         | 🔥       | 1.20×      | Single flame, soft particle halo  |
| 7-13        | 🔥🔥     | 1.50×      | Two flames, stronger halo         |
| 14-29       | 🔥🔥🔥   | 1.75×      | Three flames, full particle field |
| 30+         | 🔥🔥🔥🔥 | 2.00× (max) | Four flames, intense gradient halo |

Flames render next to the level number on UserProfile's big card
and next to the avatar badge on Home. Gradient + particle effects,
not flat CSS — tier bump triggers a one-shot celebration.

### Shield schedule (streak protection)

Shields are auto-granted at tier thresholds, regenerate on time,
and are NOT purchasable with XP (keeps the economy honest).

| Streak   | Shields held    | Regen                  | On miss                                    |
| -------- | --------------- | ---------------------- | ------------------------------------------ |
| 1-6      | 0               | —                      | Reset to 0. Low sunk cost, fair.           |
| 7-13     | 1               | 1 / 14 days            | Shield burns, streak survives, continues.  |
| 14-29    | 2               | 1 / 7 days             | Shield burns; second miss in window resets.|
| 30+      | 3 + insurance   | 1 / 7 days (cap 3)     | Shields burn first; then 48-hr revival.    |

### Streak insurance (L30+ only)

If all shields are exhausted and a day is missed, the streak enters
a 48-hour revival window:

- Any tracked action within 48h restores the streak at the SAME tier.
- Revival costs a flat **200 XP fee** (deducted from `total_xp`,
  never taking the user below their current level floor).
- One revival per 14 days — can't be used as an infinite safety net.

### Break UX

Breaking a streak is a moment the app should own. Gentle, not
punishing. Show the streak tombstone ("🔥×30 — nice run"), the peak
reached, and a single CTA to start a new one. No guilt copy.

---

## 4. Anti-grind — caps & daily login roll

### Ordering of multipliers vs. caps

For each individual XP event, in order:

1. Compute **base XP** for the source.
2. Apply **curated ladder multiplier** (§2) if the source is a
   curated cook. (Flat bonuses skip this.)
3. Apply **per-source micro-cap** (below). If already at cap for
   the day, event earns 0 for that source.
4. Add to today's **running raw total**. Apply soft-cap haircut
   (below) to anything above the soft threshold.
5. Apply **fire-mode streak multiplier** (§3). Streak multiplier
   is NOT subject to caps — a 🔥🔥🔥🔥 day-30 user earns 2× what
   a day-2 user earns for the same effort.
6. Commit to `xp_events` + increment `profiles.total_xp`.

### Daily raw-XP caps (pre-streak)

| Threshold | Amount | Behavior                                           |
| --------- | ------ | -------------------------------------------------- |
| Soft cap  | 200 XP | XP earned above 200 counts at **50%**.             |
| Hard cap  | 400 XP | Nothing above 400 raw XP counts for today. Drops.  |

A normal engaged day (cook + scan + a bonus or two) lands around
150-250. You have to grind to hit the soft cap; you have to farm
to hit the hard cap.

### Per-source micro-caps (daily)

| Source              | Cap                           |
| ------------------- | ----------------------------- |
| Scans / pantry adds | 50 XP/day (≈10 scans)         |
| Photos              | 2 photos per cook             |
| Diner / eat-together| 3 bonuses/day                 |
| Review a cook       | 3/day                         |
| Pantry hygiene      | 10 XP/day (≈5 edits)          |
| Nutrition goal day  | 1/day                         |
| Author's cut        | 3× per recipe, lifetime       |
| Cook-together       | 1× per partner pair per day   |

Onboarding starter-pack entries are exempt — those are one-time
and should never hit a cap.

### Daily login roll

On the user's first tracked action of the day (not just app open —
an affirmative act), spin once. Shown as a scratch-card animation
on the Home surface. Purely additive, separate from cook flow, not
farmable.

| Weight | Rarity   | Reward                                               |
| ------ | -------- | ---------------------------------------------------- |
| 70%    | Common   | +5 XP                                                |
| 20%    | Uncommon | +15 XP                                               |
| 8%     | Rare     | +50 XP                                               |
| 2%     | Epic     | +150 XP + 24-hr cosmetic flair on profile            |

Epic flair = gradient border + sparkle particles on the profile
avatar, expires at next local 04:00 rollover. No permanent rarity
inflation — it's a daily treat.

Roll is stored on `profiles.daily_roll_date` + `daily_roll_result`
so it can't be re-rolled by refreshing. Server-side RNG only
(never trust a client-seeded roll with XP on the line).

---

## 5. Cook-complete toast choreography

### Core principle

**Sequential reveals, not a receipt.** Each bonus pops in solo,
holds the spotlight ~600-800ms, then the next one surprises. User
doesn't know a first-time bonus was coming until it lands. No
up-front itemized list — the reveal IS the reward.

### Beat sequence (example: curated first-time cook, streaked, eaten together)

```
Beat 1  (0.0s)   "+50"  Cook complete            tan pulse, settle
Beat 2  (0.7s)   "+100" First-time recipe!       gold burst, particles
Beat 3  (1.4s)   "×1.5" Curated (Italian · L1)   tan glow, multiplier bloom
Beat 4  (2.2s)   "+15"  Plan → Cook closed        blue slide-in
Beat 5  (2.9s)   "+50"  Eaten together            soft warm glow
Beat 6  (3.7s)   "×1.5" 🔥🔥 7-day streak         flame sweep across canvas
Beat 7  (4.5s)   Total ticks up to final value    counter ramp + flourish
```

Actual order resolved at render time by deterministic sort (so the
same cook always plays the same beats in the same order):

1. Base cook XP first
2. Flat stacking bonuses (first-time → plan→cook → eat-together → photo → review)
3. Curated multiplier reveal (if applicable) — the "quality tier"
   flourish
4. Per-skill XP rollup as a single beat ("+45 skill XP")
5. Streak multiplier last, right before total ramp
6. Total counter ramp (final flourish)

### Timing & interaction

- Each beat: **600-800ms** (fade-in 150ms, hold, fade-out 150ms).
- Tap anywhere: **fast-forwards** to the total. No user is ever
  trapped watching an animation they've already seen.
- If the screen closes mid-sequence (back nav, app background):
  XP is **already committed server-side**, so closing does not
  lose points. The toast is just celebration theater.
- Full sequence hard-capped at **~7 seconds**. Beyond that, batch
  tail bonuses into a single "+N more bonuses" beat so we don't
  punish users with long sequences.

### Realtime +N XP toasts (outside the cook flow)

For one-off events (scan, photo, canonical, daily-roll, badge
earn), a smaller top-right toast slides in:

```
  +15 XP   Canonical submitted
```

Toast sits for ~2s, then slides out. Color pulled from the reserved
palette when the event maps to an axis (canonical → tan, storage →
blue, etc.). Stacking: if multiple events fire within 400ms, they
queue instead of overlapping.

### Level-up moment

Separate, bigger than a toast — a full-screen celebration when
`total_xp` crosses a level boundary:

- Avatar zoom, level number increments with spring physics
- New title card ("Sous Chef") fades in
- Any newly-unlocked features/titles/badges flash through
- Single "Keep cooking" CTA dismisses

Stacks AFTER the cook-complete sequence — total ticks up, *then*
the level-up ceremony plays. Never interrupts mid-sequence.

---

## 6. Data model — what exists vs. what we scaffold

### Already in place (verified via repo scan)

| Asset                                      | Location                                      |
| ------------------------------------------ | --------------------------------------------- |
| `profiles.total_xp`                        | `supabase/migrations/0001_init.sql`           |
| `profiles.streak_count`                    | `supabase/migrations/0001_init.sql`           |
| `profiles.last_cooked_date`                | `supabase/migrations/0001_init.sql`           |
| `profiles.skill_levels` (jsonb)            | `supabase/migrations/0001_init.sql`           |
| `profiles.cuisines_cooked` (text[])        | `supabase/migrations/0001_init.sql`           |
| `cook_logs.xp_earned` (per-cook, populated)| `supabase/migrations/0013_cook_logs.sql`      |
| Client-side sum of `xp_earned`             | `src/lib/useUserProfile.js:110`               |
| `badges.tier` column                       | `supabase/migrations/0019_badges.sql:36`      |
| `user_recipes.source` ('custom' \| 'ai')   | `supabase/migrations/0051_user_recipes.sql`   |
| Bundled recipes w/ `route: ["plan","learn"]`| `src/data/recipes/*.js`                      |
| Bundled recipes w/ `skills: [{id, xp}]`    | `src/data/recipes/*.js`                       |
| Bundled recipes w/ `cuisine:` field        | `src/data/recipes/*.js` (most, not all)       |
| Skill tree (7 × 5)                         | `src/data/index.js:53-61`                     |
| Cook-complete celebration surface          | `src/components/CookComplete.jsx`             |
| Cook-log hook                              | `src/lib/useCookLog.js`                       |

### Needs scaffolding

**Schema (new migrations):**

0. **Config tables** — source of truth for every tunable:
   - `xp_config` — key/jsonb/description/updated_at/updated_by.
     Holds scalars: soft_cap, hard_cap, soft_cap_haircut_pct,
     xp_curve_coefficient, xp_curve_exponent, revival_fee, etc.
   - `xp_source_values` — one row per source (cook, scan, photo,
     plan_cook_closed, eat_together, …): base_xp, per_day_cap,
     per_cook_cap, flat_bonus (bool, skips curated multiplier).
   - `xp_streak_tiers` — `(tier_idx, min_days, multiplier,
     shield_capacity, shield_regen_days, flame_count,
     particle_intensity)`.
   - `xp_curated_ladder` — `(min_lessons_in_cuisine, multiplier)`.
   - `xp_rarity_rolls` — `(rarity, weight_pct, xp_reward,
     cosmetic_flair)`.
   - `xp_badge_tier_xp` — `(tier, xp_reward)`.
   - `xp_level_titles` — `(min_level, max_level, title)`.
   - `xp_config_audit` — immutable log of every config mutation
     (table name, row pk, old jsonb, new jsonb, actor, at). Admin
     writes go through an RPC that writes audit in the same txn.
   `award_xp()` reads these at evaluation time with a short-lived
   (~30s) in-transaction cache to avoid hammering the tables on a
   busy request.

1. **`xp_events` table** — the ledger. One row per earn event.
   Columns: `id`, `user_id`, `source` (enum), `base_xp`,
   `curated_mult`, `cap_adjustment`, `streak_mult`, `final_xp`,
   `ref_table` + `ref_id` (e.g. `cook_logs` + uuid), `created_at`,
   `day_local` (date in user's tz, indexed for daily-cap lookups).
   This is the source of truth — `profiles.total_xp` becomes a
   materialized sum updated by trigger.
2. **`profiles.level` (numeric)** — new int column. Existing TEXT
   `profiles.level` is renamed to `profiles.skill_self_report` in
   the same migration; all read sites updated in the same PR.
   See §7 decision #1.
3. **`profiles.streak_shields`** — int (count held).
4. **`profiles.streak_peak`** — int (highest ever, for tombstone).
5. **`profiles.streak_tier`** — denormalized int (0-4) for fast
   multiplier lookup without recomputing from `streak_count`.
6. **`profiles.streak_insurance_last_used`** — timestamptz.
7. **`profiles.daily_roll_date` + `daily_roll_result`** — for the
   login roll (anti-refresh).
8. **`profiles.timezone`** — if not already present. Required for
   correct local-day rollover.
9. **`badges.tier`** — expand check constraint from
   `('standard','bronze','silver','gold')` to include
   `('common','uncommon','rare','legendary')`, or remap existing.
   Decide before shipping so existing badges get the right XP.
10. **`user_recipes.cuisine`** — add column so authored recipes
    can participate in the curated ladder if ever promoted to
    "learn" route.
11. **`recipe_first_cooks`** — dedup table for the first-time-recipe
    bonus: `(user_id, recipe_key)` unique. `recipe_key` is a string
    that covers both bundled slugs and `user_recipes.id`.
12. **`recipe_mastery`** — `(user_id, recipe_key, cook_count)` to
    drive 5×/10×/25× milestones without scanning `cook_logs` on
    every cook.

**Server logic (new Postgres functions + triggers OR edge functions):**

13. **`award_xp(user_id, source, base, ref)`** — single entry point.
    Applies curated ladder → per-source micro-cap → soft/hard cap →
    streak multiplier, in order from §4. Writes `xp_events`,
    increments `profiles.total_xp`, returns a breakdown the client
    uses to drive the toast sequence (§5).
14. **Streak tick** — runs on every tracked event. Increments
    `streak_count` if `last_activity_date` = yesterday local; burns
    a shield if 1 day gap and shield held; resets otherwise. Bumps
    `streak_tier`.
15. **Shield regen cron** — daily job checks regen schedule per §3.
16. **Canonical-approval hook** — when an `ingredient_info` approval
    row lands, retro-award +25 XP to the original canonical creator.
17. **Badge-award hook** — existing badge grant triggers XP using
    `badges.tier` → `{common:50, uncommon:100, rare:250, legendary:500}`.

**Client:**

18. **`CookComplete.jsx`** — replace single xp_earned display with
    the beat-sequenced reveal from §5. Drive off the `award_xp`
    breakdown payload.
19. **UserProfile card** — level tier + flame stack + particle halo
    intensity keyed to `streak_tier`.
20. **Home avatar badge** — small flame count overlay.
21. **Daily-roll scratch card** — new surface on Home, triggered
    on first tracked action if `daily_roll_date < today_local`.
22. **Realtime +N toasts** — small queue component.
23. **Level-up ceremony** — full-screen modal, triggered when
    `total_xp` crosses `xp_to_next(current_level)`.

---

## 7. Open questions & implementation phases

### Decisions locked

1. **`profiles.level` column collision — RESOLVED.** Existing TEXT
   column (`'beginner' | 'intermediate' | 'advanced'`) will be
   **renamed to `profiles.skill_self_report`**. A new numeric
   `profiles.level` column will hold the XP tier. Phase 1
   migration does the rename + column add atomically; every read
   site gets audited and updated in the same migration PR so the
   app never sees the intermediate state.

### Open questions (non-blocking)

2. **Badge tier remap.** Existing constraint is
   `('standard','bronze','silver','gold')`. Mapping proposal:
   `standard → common`, `bronze → uncommon`, `silver → rare`,
   `gold → legendary`. Fine unless there are design connotations
   baked in ("gold" ≠ "legendary" feel).
3. **Cuisine tag completeness on bundled recipes.** Sampled a few
   — `aglio-e-olio`, `cacio-e-pepe`, `caprese-sandwich` all carry
   `cuisine:`. Need a pass to ensure 100% of "learn"-route recipes
   have a cuisine before the curated ladder ships (ladder needs it
   to count per-cuisine progress).
4. **"Collection" grouping.** Curated-collection completion bonus
   (+500) and Master badge (+1000) assume a concept of a set. Is
   that a field on recipes (`collection: 'italian-basics'`), or a
   separate table? Probably a lightweight field — deferrable.
5. **Revival fee cap interactions.** If a 200-XP insurance fee would
   push a user below their level's floor, do we (a) deduct less,
   (b) refuse revival, or (c) allow temporary negative-toward-next?
   **Recommendation: (a).** Never take a user backward in level.

### Commit granularity

Each phase below is further broken into micro-commits so a session
can pick up mid-phase without holding the full context. Rules:

- Every commit compiles, migrations up cleanly, app still boots.
- Config tables ship schema + seed in one commit (seed is what
  makes them useful and it's a one-shot insert).
- Never split a rename from its read-site updates — they ship
  together or the app breaks.
- Build `award_xp()` up in stages; each stage leaves the function
  correct for the features shipped so far.

**Phase 1 commits (21 files):**

*Config scaffolding (one table per commit):*
1. `0071_xp_config.sql` — table + seed scalars
2. `0072_xp_source_values.sql` — table + seed rows
3. `0073_xp_streak_tiers.sql` — table + seed
4. `0074_xp_curated_ladder.sql` — table + seed
5. `0075_xp_rarity_rolls.sql` — table + seed
6. `0076_xp_badge_tier_xp.sql` — table + seed
7. `0077_xp_level_titles.sql` — table + seed
8. `0078_xp_config_audit.sql` — table + trigger on all xp_config* tables

*`profiles.level` collision:*
9. `0079_profiles_skill_self_report.sql` — rename TEXT `level` →
   `skill_self_report`. Same PR updates every read site.
10. `0080_profiles_level_numeric.sql` — add new numeric `level`
    (default 1).

*Ledger + dedup tables:*
11. `0081_xp_events.sql` — ledger table + indexes.
12. `0082_recipe_first_cooks.sql` — dedup for first-time bonus.
13. `0083_recipe_mastery.sql` — cook_count per user/recipe.

*`award_xp()` built up in stages (each commit = one rule, tests
pass at each step):*
14. `0084_award_xp_stub.sql` — writes `xp_events`, returns base
    XP only, no multipliers/caps.
15. `0085_award_xp_micro_caps.sql` — per-source micro-cap logic.
16. `0086_award_xp_daily_caps.sql` — soft/hard daily caps. (Streak
    + curated multipliers defer to Phase 3/4.)

*Integration + backfill:*
17. Swap `cook_logs.xp_earned` insert path to call `award_xp`
    (no migration, code only).
18. `scripts/backfill_xp_events.sql` — replay existing `cook_logs`
    into `xp_events` so `total_xp` reconciles.

(Phases 2–6 commit breakdowns will be added as each phase begins.)

### Implementation phases

Each phase is independently shippable and leaves the app better
than it found it.

**Phase 1 — Ledger & award pipeline (no UI changes)**
- Migrations: `xp_events`; rename `profiles.level` →
  `skill_self_report` + add new numeric `profiles.level`;
  `recipe_first_cooks`; `recipe_mastery`. Audit + update every
  read site of the old TEXT `level` in the same PR.
- `award_xp()` server function — all anti-grind math, no streak
  multiplier yet (passthrough).
- Swap the existing `cook_logs.xp_earned` path to call `award_xp`.
- Backfill: one-shot script to populate `xp_events` from existing
  `cook_logs` so `total_xp` reconciles.
- Ship quietly. Telemetry only.

**Phase 2 — Expanded XP sources**
- Hook `award_xp` into scan, photo, canonical create, canonical
  approve, plan→cook closure, eat-together, review, nutrition-goal,
  pantry-hygiene, new-recipe, onboarding starter pack.
- Badge-award hook + badge tier expansion.
- Mastery counters update on cook.
- Ship with the existing cook-complete UI still showing a single
  xp_earned number.

**Phase 3 — Fire mode**
- Migrations: `streak_shields`, `streak_peak`, `streak_tier`,
  `streak_insurance_last_used`, `timezone`.
- Streak tick logic + shield regen cron.
- Plug streak multiplier into `award_xp` (AFTER cap, per §4 step 5).
- UserProfile flame stack + Home avatar overlay.
- Streak break UX (tombstone).
- Insurance flow (L30+ only).

**Phase 4 — Curated ladder + level system**
- Curated multiplier calculation in `award_xp` (cuisine-scoped
  lesson count).
- Level curve + `xp_to_next()`.
- Level titles on UserProfile.
- Level-up ceremony modal.
- Audit bundled "learn" recipes for cuisine completeness.

**Phase 5 — Celebration layer (the "WHY" reveal)**
- Rewrite `CookComplete.jsx` cook-complete scene to beat-sequenced
  reveals from §5. Drive off the `award_xp` breakdown payload.
- Realtime +N toast queue component.
- Wire toasts to every non-cook earn event.

**Phase 6 — Daily roll + polish**
- Daily-roll scratch card on Home.
- Epic flair cosmetic (24h gradient border).
- Particle-effect tuning on flame tiers.
- Admin dashboard: XP economy observability (daily median XP,
  cap-hit rate, revival usage).

### Telemetry to instrument from phase 1

- Median / P90 XP per active user per day
- % of earn events that hit soft cap / hard cap
- Distribution of streak length
- Shield burn rate vs. regen rate
- Revival usage frequency
- Curated vs. non-curated cook share
- Median time to L10 (target: ~1 month of regular engagement)

If curve tuning is needed, adjust `xp_to_next()` — NOT the per-event
XP values. Keeps event values stable (they show up in toasts) while
level pacing stays flexible.

---

*End of plan.*

