// Infer the three identity-stack axes a fresh scan should land on
// just from OFF's categoryHints — useful when canonicalResolver's
// tiers all miss on a brand-new UPC so canon is null. Without this,
// the draft card opens with "+ SET CATEGORY" and "+ SET LOCATION"
// empty affordances AND defaults the row's location to "pantry"
// (defaultLocationForCategory falls through for everything that
// isn't dairy/meat/produce/frozen). The user gets a Pepsi Zero
// parked in the pantry tab with no category — worse UX than just
// reading OFF's own taxonomy for hints.
//
// Returns { category, tileId, typeId }. Any field may be null when
// the hints don't give a confident signal. Precedence is ordered so
// frozen always wins over the underlying food family (frozen-yogurts
// → freezer, not fridge); dairy wins over produce (milk-based
// smoothies → dairy, not beverage); beverage wins over produce
// (fruit juices → beverage).
//
// category values mirror what the bundled INGREDIENTS registry uses
// (dairy, meat, produce, pantry) plus the new "beverage" and
// "frozen" tokens that defaultLocationForCategory understands (see
// usePantry.js). tileId values come from the tile registries under
// src/lib/tileKeywords and its fridge/pantry/freezer tile catalogs.
// typeId values are WWEIA food-type slugs from src/data/foodTypes.

export function tagHintsToAxes(categoryHints) {
  const text = (Array.isArray(categoryHints) ? categoryHints : [])
    .join(" ")
    .toLowerCase();
  if (!text) return { category: null, tileId: null, typeId: null };

  // FROZEN — overrides every other family. An OFF row tagged
  // "frozen-yogurts, frozen-dairy-desserts" should land in the
  // freezer, not the fridge, even though "dairy" also matches below.
  if (/\bfrozen[- ]/.test(text) || /\bfrozen-foods?\b/.test(text)) {
    // Narrow the tile by what's frozen — frozen fruit and frozen
    // meat live in different tabs even though both are freezer-
    // located.
    if (/\b(frozen[- ])?(meat|poultry|beef|chicken|pork|turkey|sausage)/.test(text)) {
      return { category: "frozen", tileId: "frozen_meat_poultry", typeId: null };
    }
    if (/\b(frozen[- ])?(fish|seafood|shrimp|salmon|tuna)/.test(text)) {
      return { category: "frozen", tileId: "frozen_seafood", typeId: null };
    }
    if (/\b(frozen[- ])?(fruit|berries|berry)/.test(text)) {
      return { category: "frozen", tileId: "frozen_fruit", typeId: null };
    }
    if (/\b(frozen[- ])?(vegetable|vegetables|veg)/.test(text)) {
      return { category: "frozen", tileId: "frozen_veg", typeId: null };
    }
    if (/\b(ice[- ]cream|frozen[- ](yogurt|dessert|treat))/.test(text)) {
      return { category: "frozen", tileId: "frozen_desserts", typeId: null };
    }
    if (/\b(frozen[- ])?(pizza|meal|lasagna|burrito|entree)/.test(text)) {
      return { category: "frozen", tileId: "frozen_meal_prep", typeId: null };
    }
    return { category: "frozen", tileId: "frozen_meal_prep", typeId: null };
  }

  // BEVERAGES — sodas, juices, water, coffee, tea, etc. These land
  // in the fridge under the drinks tile. Explicitly includes
  // "cola" / "colas" / "soft-drink" for the renamed mise canonical
  // the user is moving toward.
  if (/\b(beverage|beverages|drink|drinks|soda|sodas|cola|colas|soft-drink|soft-drinks|carbonated|juice|juices|smoothie|shake|tea|teas|coffee|coffees|water|waters|kombucha|cider|lemonade)\b/.test(text)) {
    return { category: "beverage", tileId: "drinks", typeId: "wweia_juices" };
  }

  // DAIRY — yogurts, cheeses, milks, butters, creams.
  if (/\b(dairy|dairies|yogurt|yogurts|yoghurt|cheese|cheeses|milk|milks|buttermilk|cream|butter|curd|kefir|quark|skyr)\b/.test(text)) {
    return { category: "dairy", tileId: "dairy", typeId: null };
  }

  // MEAT & POULTRY.
  if (/\b(meat|meats|poultry|beef|pork|chicken|turkey|lamb|veal|duck|sausage|sausages|bacon|ham|salami|prosciutto|pastrami|deli|cold-cut)\b/.test(text)) {
    return { category: "meat", tileId: "meat_poultry", typeId: null };
  }

  // SEAFOOD — grouped under meat category (mise's registry does the
  // same) but on its own fridge tile.
  if (/\b(fish|fishes|seafood|shellfish|shrimp|salmon|tuna|cod|halibut|crab|lobster|scallop|scallops|sardine|anchov|mussel|oyster|clam|tilapia|trout|mackerel|sushi)\b/.test(text)) {
    return { category: "meat", tileId: "seafood", typeId: null };
  }

  // PRODUCE — fresh fruits and vegetables.
  if (/\b(fruit|fruits|vegetable|vegetables|produce|berry|berries|leafy|greens|salad|apple|citrus|melon|stone-fruit)\b/.test(text)) {
    return { category: "produce", tileId: "produce", typeId: null };
  }

  // BAKING staples.
  if (/\b(baking|flour|flours|sugar|sugars|starch|starches|cornmeal|yeast|baking-powder|baking-soda|cocoa|chocolate-chip)\b/.test(text)) {
    return { category: "pantry", tileId: "baking", typeId: null };
  }

  // SAUCES & CONDIMENTS (shelf-stable defaults). After-open these
  // often move to the fridge, but for a fresh sealed package pantry
  // is the right first-state.
  if (/\b(sauce|sauces|condiment|condiments|ketchup|mustard|mayonnaise|mayo|vinegar|vinegars|dressing|dressings|marinade|salsa|hot-sauce|soy-sauce)\b/.test(text)) {
    return { category: "pantry", tileId: "condiments_sauces", typeId: null };
  }

  // PASTA, GRAINS, CEREALS.
  if (/\b(pasta|pastas|noodle|noodles|spaghetti|rice|rices|cereal|cereals|oat|oats|quinoa|couscous|bulgur|grain|grains)\b/.test(text)) {
    return { category: "pantry", tileId: "pasta_grains", typeId: null };
  }

  // BEANS & LEGUMES.
  if (/\b(bean|beans|lentil|lentils|chickpea|chickpeas|legume|legumes)\b/.test(text)) {
    return { category: "pantry", tileId: "beans_legumes", typeId: null };
  }

  // SNACKS & CRACKERS.
  if (/\b(snack|snacks|cracker|crackers|chip|chips|pretzel|pretzels|popcorn|trail-mix|granola-bar)\b/.test(text)) {
    return { category: "pantry", tileId: "canned_jarred", typeId: null };
  }

  // CANNED & JARRED (tomatoes, beans in cans, jars, preserves).
  if (/\b(canned|jarred|preserved|pickled|preserve|jam|jelly|marmalade)\b/.test(text)) {
    return { category: "pantry", tileId: "canned_jarred", typeId: null };
  }

  // OILS & FATS.
  if (/\b(oil|oils|olive-oil|cooking-oil|vegetable-oil|shortening|lard)\b/.test(text)) {
    return { category: "pantry", tileId: "oils_fats", typeId: null };
  }

  // SPICES & DRIED HERBS.
  if (/\b(spice|spices|dried-herb|dried-herbs|seasoning|seasonings)\b/.test(text)) {
    return { category: "pantry", tileId: "spices_dried_herbs", typeId: null };
  }

  // NUTS & SEEDS.
  if (/\b(nut|nuts|seed|seeds|almond|almonds|peanut|peanuts|cashew|cashews|walnut|walnuts|pistachio|pistachios|pecan|pecans)\b/.test(text)) {
    return { category: "pantry", tileId: "nuts_seeds", typeId: null };
  }

  // BREAD & BAKED GOODS.
  if (/\b(bread|breads|loaf|baguette|tortilla|tortillas|pita|naan|bagel|bagels|bun|buns|roll|rolls)\b/.test(text)) {
    return { category: "pantry", tileId: "bread", typeId: null };
  }

  // SWEETS & CONFECTIONERY (pantry side — fresh baked goods land in
  // bread above via the specific tokens).
  if (/\b(sweet|candies|candy|chocolate|chocolates|confection|cookie|cookies|dessert)\b/.test(text)) {
    return { category: "pantry", tileId: "sweeteners", typeId: null };
  }

  return { category: null, tileId: null, typeId: null };
}
