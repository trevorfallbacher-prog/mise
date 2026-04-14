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
# Open .env and add your Anthropic API key

# 3. Run it
npm start
```

App opens at `http://localhost:3000`

---

## Getting an API Key

1. Go to https://console.anthropic.com
2. Create an account / sign in
3. Go to API Keys → Create Key
4. Paste it in your `.env` file:

```
REACT_APP_ANTHROPIC_API_KEY=sk-ant-...
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
- **AI Receipt Scanner** — upload a photo of any grocery receipt, Claude Vision reads every item and quantities, updates pantry automatically
- Pantry deduction — log a cooked dish and ingredients auto-deduct

---

## Stack

- React 18 (Create React App)
- Claude API (claude-sonnet-4-20250514) for receipt scanning
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
