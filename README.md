# mise 👨‍🍳

> Learn to cook like a pro. One skill at a time.

A Duolingo-style cooking app with animated step-by-step recipes, skill trees, seasonal recommendations, a personal cookbook with memory, and AI-powered pantry management via receipt scanning.

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Set up your API key
cp .env.example .env
# Open .env and add your Supabase keys

# 3. Run it
npm start
```

App opens at `http://localhost:3000`

---

## Development + Testing Workflow

### 1) Pull the latest branch and run locally

If you're already in this repo, this is the exact flow:

```bash
git fetch origin
git checkout claude/continue-previous-work-kQbiC
git pull origin claude/continue-previous-work-kQbiC
npm install
npm start
```

If `npm start` is already running in a terminal, stop it first with `Ctrl + C`,
then run the commands above.

If you're already on that branch, this one-liner also works:

```bash
git pull origin claude/continue-previous-work-kQbiC && npm start
```

### Pull + restart (copy/paste quick version)

```bash
cd /workspace/mise
git fetch origin
git checkout claude/continue-previous-work-kQbiC
git pull --ff-only origin claude/continue-previous-work-kQbiC
npm install
npm start
```

### 2) Dev-test checklist (manual)

After `npm start`, run through:

1. Sign in (magic link or Google).
2. Complete onboarding if prompted.
3. Go to **Pantry**:
   - Add an item manually and confirm it appears.
   - Remove an item and confirm it disappears.
   - Open receipt scan flow and upload an image.
4. Go to **Cook**:
   - Open a recipe.
   - Add missing ingredients to shopping list (if prompted by recipe flow).
5. Go to **Shopping List**:
   - Mark an item as bought and confirm it moves to Pantry.

### 3) Build-test before shipping

```bash
npm run build
```

This confirms production bundling succeeds.

---

## Supabase Setup

Paste your Supabase settings (Project Settings → API) into `.env`:

```
REACT_APP_SUPABASE_URL=https://your-project.supabase.co
REACT_APP_SUPABASE_ANON_KEY=your_publishable_or_anon_key_here
```

---

## What's Built So Far

### Onboarding
- One question per screen — dietary preferences, vegan style (if applicable), cooking level, goals
- Personalized skill tree + seasonal suggestions built on completion

### Home Screen
- Seasonal banner with upcoming holiday events (reads from calendar)
- Personalized Easter/holiday course preview based on dietary profile
- Skill tree with XP bars and locked skills
- Streak tracking

### Cook Mode
- Animated SVG illustrations for each step (boiling, stirring, browning, etc.)
- Built-in countdown timers per step
- Step-by-step progress with completion tracking
- Chef tips on every step

### Cookbook
- Personal recipe library with occasion tagging (Date Night, Kids, Family, etc.)
- Memory notes per recipe ("Made these with my parents")
- Filter by occasion, search by name
- "What's Next" suggestions for leveling up skills
- Calendar integration showing upcoming moments (Mother's Day, birthdays)

### Pantry
- Ingredient inventory with visual fill bars
- Low stock alerts with one-tap add to shopping list
- **AI Receipt Scanner** — upload a photo of any grocery receipt, an edge function reads every item and quantities, updates pantry automatically
- Pantry deduction — log a cooked dish and ingredients auto-deduct

---

## Stack

- React 18 (Create React App)
- Supabase Edge Function for receipt scanning (model/provider configured server-side)
- No external UI libraries — all custom CSS-in-JS
- Fonts: Fraunces (serif) + DM Sans + DM Mono via Google Fonts

---

## Next Up

- [ ] Photo capture in post-cook feedback flow
- [ ] Weekly meal planner + unified shopping list
- [ ] Google Calendar integration for birthday/anniversary detection
- [ ] Feedback flow with XP and skill progression
- [ ] More recipes + full skill tree content
- [ ] User accounts + data persistence
