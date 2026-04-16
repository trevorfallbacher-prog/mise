// Named blend presets.
//
// Composite products users frequently have on hand — Italian Blend
// cheese, Mexican Blend cheese, frozen pizza, etc. — are tagged with
// multiple canonical ingredients. Rather than forcing the user to
// pick each component one at a time in the LinkIngredient modal, we
// offer named presets that auto-fill the tag array in one tap.
//
// Shape:
//   id           - stable kebab-case identifier
//   label        - human label shown in the picker
//   emoji        - display glyph
//   description  - short hint under the label
//   ingredientIds- canonical ids this preset expands to. Every id must
//                  exist in the INGREDIENTS registry; the UI filters
//                  out any unresolved ids so a registry pruning doesn't
//                  leave the preset broken.
//
// Adding a preset: append an entry, ensure every id exists, ship. No
// migration needed — purely client-side convenience.

export const BLEND_PRESETS = [
  {
    id: "italian-blend",
    label: "Italian Blend",
    emoji: "🧀",
    description: "Mozzarella + provolone + parmesan + romano",
    ingredientIds: ["mozzarella", "provolone", "parmesan", "pecorino"],
  },
  {
    id: "mexican-blend",
    label: "Mexican Blend",
    emoji: "🧀",
    description: "Cheddar + monterey jack + queso + more",
    ingredientIds: ["cheddar", "monterey_jack", "queso_fresco", "pepper_jack"],
  },
  {
    id: "pizza-blend",
    label: "Pizza Blend",
    emoji: "🍕",
    description: "Low-moisture mozzarella + provolone",
    ingredientIds: ["mozzarella", "provolone"],
  },
  {
    id: "four-cheese",
    label: "Four Cheese",
    emoji: "🧀",
    description: "Mozzarella + parmesan + asiago + fontina",
    ingredientIds: ["mozzarella", "parmesan", "asiago", "fontina"],
  },
  {
    id: "frozen-pizza-cheese",
    label: "Frozen Pizza (Cheese)",
    emoji: "🍕",
    description: "Crust + sauce + mozzarella",
    ingredientIds: ["pizza_dough", "tomato_sauce", "mozzarella"],
  },
  {
    id: "frozen-pizza-pepperoni",
    label: "Frozen Pizza (Pepperoni)",
    emoji: "🍕",
    description: "Crust + sauce + mozzarella + pepperoni",
    ingredientIds: ["pizza_dough", "tomato_sauce", "mozzarella", "pepperoni"],
  },
  {
    id: "mac-and-cheese",
    label: "Mac & Cheese (Boxed)",
    emoji: "🧀",
    description: "Pasta + cheddar sauce mix",
    ingredientIds: ["pasta", "cheddar"],
  },
  {
    id: "ramen-instant",
    label: "Instant Ramen",
    emoji: "🍜",
    description: "Noodle block + seasoning packet",
    ingredientIds: ["ramen_noodles", "chicken_bouillon"],
  },
  {
    id: "hummus",
    label: "Hummus",
    emoji: "🫛",
    description: "Chickpeas + tahini + lemon + garlic + olive oil",
    ingredientIds: ["chickpeas", "tahini", "lemon", "garlic", "olive_oil"],
  },
  {
    id: "pesto-jarred",
    label: "Pesto (Jarred)",
    emoji: "🌿",
    description: "Basil + pine nuts + parmesan + olive oil + garlic",
    ingredientIds: ["basil", "pine_nuts", "parmesan", "olive_oil", "garlic"],
  },
  {
    id: "mirepoix",
    label: "Mirepoix",
    emoji: "🥕",
    description: "Onion + carrot + celery",
    ingredientIds: ["onion", "carrot", "celery"],
  },
  {
    id: "soffritto",
    label: "Soffritto",
    emoji: "🧅",
    description: "Onion + garlic + olive oil",
    ingredientIds: ["onion", "garlic", "olive_oil"],
  },
];
