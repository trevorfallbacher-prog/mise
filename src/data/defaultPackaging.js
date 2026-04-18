// Category → suggested packaging sizes seed.
//
// When a user creates a brand-new canonical via LinkIngredient's
// "+ CREATE" flow and picks a category, we pre-fill the packaging
// step with a set of common sizes for that category. The user can
// add, remove, rename, or reorder — but starting from a plausible
// set makes the choice feel concrete instead of staring at an empty
// form.
//
// Bundled canonicals can also reference these defaults via
// seedPackaging(category) below if they don't carry their own
// explicit list. Everything here is easily tunable; the only
// contract is the shape: { amount: number, unit: string, label: string }
// with exactly one entry marked with label "typical" as the UX default.

export const DEFAULT_PACKAGING_BY_CATEGORY = {
  // Shelf-stable canned goods — 5-oz tuna cans to 25-oz Spam family size.
  meat: [
    { amount: 7,  unit: "oz", label: "single-serve" },
    { amount: 12, unit: "oz", label: "standard"     },  // ← typical
    { amount: 25, unit: "oz", label: "family"       },
  ],
  // Most canned vegetables / beans / tomatoes land in a narrow band here.
  canned: [
    { amount: 14.5, unit: "oz", label: "standard"     },  // ← typical
    { amount: 28,   unit: "oz", label: "large"        },
    { amount: 6,    unit: "oz", label: "mini (tomato paste / chipotle)" },
  ],
  // Dry pantry staples — pasta, cereal, flour bags, sugar.
  pantry: [
    { amount: 16, unit: "oz", label: "standard box / bag" },  // ← typical
    { amount: 2,  unit: "lb", label: "2 lb bag"           },
    { amount: 5,  unit: "lb", label: "5 lb bag"           },
  ],
  // Rice specifically — household range skews bigger than pasta.
  grain: [
    { amount: 1,  unit: "lb", label: "small"   },
    { amount: 5,  unit: "lb", label: "standard" },  // ← typical
    { amount: 20, unit: "lb", label: "bulk"     },
  ],
  // Condiments and jarred goods — olive oil, hot sauce, jam.
  condiment: [
    { amount: 12, unit: "fl_oz", label: "standard jar/bottle" },  // ← typical
    { amount: 17, unit: "fl_oz", label: "large" },
    { amount: 25, unit: "fl_oz", label: "value" },
  ],
  // Dairy — milk, yogurt, sour cream.
  dairy: [
    { amount: 8,  unit: "oz", label: "single-serve" },
    { amount: 32, unit: "oz", label: "quart"        },  // ← typical
    { amount: 64, unit: "oz", label: "half-gallon"  },
  ],
  // Produce doesn't usually have packaging, but some boxed / bagged produce does.
  produce: [
    { amount: 5,  unit: "oz", label: "clamshell (greens)" },  // ← typical
    { amount: 1,  unit: "lb", label: "1 lb bag"           },
    { amount: 3,  unit: "lb", label: "3 lb bag"           },
  ],
  // Frozen — bags of vegetables, bricks of berries.
  frozen: [
    { amount: 10, unit: "oz", label: "small bag" },
    { amount: 16, unit: "oz", label: "standard"  },  // ← typical
    { amount: 32, unit: "oz", label: "family"    },
  ],
  // Falls through when we have no better idea. Keeps the UI from
  // rendering an empty list.
  other: [
    { amount: 1,  unit: "count", label: "small"    },
    { amount: 1,  unit: "count", label: "standard" },  // ← typical
    { amount: 1,  unit: "count", label: "large"    },
  ],
};

// Default-index lookup so the UI knows which chip to pre-select.
// Matches the array comment "← typical" on each bucket above.
const TYPICAL_INDEX = {
  meat: 1, canned: 0, pantry: 0, grain: 1, condiment: 0,
  dairy: 1, produce: 0, frozen: 1, other: 1,
};

/**
 * Looks up a suggested packaging shape for a given category.
 * Returns a fresh copy every call so callers can mutate safely.
 *
 * @param {string} category — bundled category slug
 * @returns {{ sizes: Array, defaultIndex: number }}
 */
export function suggestedPackaging(category) {
  const key = DEFAULT_PACKAGING_BY_CATEGORY[category]
    ? category
    : "other";
  return {
    sizes: DEFAULT_PACKAGING_BY_CATEGORY[key].map(s => ({ ...s })),
    defaultIndex: TYPICAL_INDEX[key] ?? 0,
  };
}
