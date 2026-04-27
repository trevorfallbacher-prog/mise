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
// Returns { category, tileId, typeId, subtype }. Any field may be
// null when the hints don't give a confident signal. Precedence is
// ordered so frozen always wins over the underlying food family
// (frozen-yogurts → freezer, not fridge); dairy wins over produce
// (milk-based smoothies → dairy, not beverage); beverage wins over
// produce (fruit juices → beverage).
//
// category values mirror what the bundled INGREDIENTS registry uses
// (dairy, meat, produce, pantry) plus the new "beverage" and
// "frozen" tokens that defaultLocationForCategory understands (see
// usePantry.js). tileId values come from the tile registries under
// src/lib/tileKeywords and its fridge/pantry/freezer tile catalogs.
// typeId values are WWEIA food-type slugs from src/data/foodTypes.
// subtype values are the brand-expertise subtype taxonomy (see
// src/data/brandExpertise.js + src/data/subtypeMap.js) — finer
// than category, used by pickPrimaryBrand to demote inclusion-
// licensor brands like M&M's on a cookie.

export function tagHintsToAxes(categoryHints) {
  const text = (Array.isArray(categoryHints) ? categoryHints : [])
    .join(" ")
    .toLowerCase();
  if (!text) return { category: null, tileId: null, typeId: null, subtype: null };

  // FROZEN — overrides every other family. An OFF row tagged
  // "frozen-yogurts, frozen-dairy-desserts" should land in the
  // freezer, not the fridge, even though "dairy" also matches below.
  if (/\bfrozen[- ]/.test(text) || /\bfrozen-foods?\b/.test(text)) {
    // Narrow the tile by what's frozen — frozen fruit and frozen
    // meat live in different tabs even though both are freezer-
    // located.
    if (/\b(frozen[- ])?(meat|poultry|beef|chicken|pork|turkey|sausage)/.test(text)) {
      return { category: "frozen", tileId: "frozen_meat_poultry", typeId: null, subtype: "chicken_cut" };
    }
    if (/\b(frozen[- ])?(fish|seafood|shrimp|salmon|tuna)/.test(text)) {
      return { category: "frozen", tileId: "frozen_seafood", typeId: null, subtype: null };
    }
    if (/\b(frozen[- ])?(fruit|berries|berry)/.test(text)) {
      return { category: "frozen", tileId: "frozen_fruit", typeId: null, subtype: null };
    }
    if (/\b(frozen[- ])?(vegetable|vegetables|veg)/.test(text)) {
      return { category: "frozen", tileId: "frozen_veg", typeId: null, subtype: null };
    }
    if (/\b(ice[- ]cream|frozen[- ](yogurt|dessert|treat))/.test(text)) {
      return { category: "frozen", tileId: "frozen_desserts", typeId: "wweia_ice_cream", subtype: "ice_cream" };
    }
    if (/\b(frozen[- ])?(pizza|meal|lasagna|burrito|entree)/.test(text)) {
      return { category: "frozen", tileId: "frozen_meal_prep", typeId: null, subtype: "boxed_meal" };
    }
    return { category: "frozen", tileId: "frozen_meal_prep", typeId: null, subtype: "boxed_meal" };
  }

  // BEVERAGES — sodas, juices, water, coffee, tea, etc. These land
  // in the fridge under the drinks tile. Explicitly includes
  // "cola" / "colas" / "soft-drink" for the renamed mise canonical
  // the user is moving toward.
  if (/\b(beverage|beverages|drink|drinks|soda|sodas|cola|colas|soft-drink|soft-drinks|carbonated|juice|juices|smoothie|shake|tea|teas|coffee|coffees|water|waters|kombucha|cider|lemonade)\b/.test(text)) {
    return { category: "beverage", tileId: "drinks", typeId: "wweia_juices", subtype: "beverage" };
  }

  // ICE CREAM — checked BEFORE general DAIRY so an "ice-cream" OFF
  // tag (which contains "cream") doesn't fall through and resolve
  // subtype="milk" via the cream-token match. Routes to the freezer
  // since ice cream is freezer-stored even when OFF didn't tag it
  // with "frozen-".
  if (/\bice[- ]cream\b|\bgelato\b|\bsorbet\b/.test(text)) {
    return { category: "frozen", tileId: "frozen_desserts", typeId: "wweia_ice_cream", subtype: "ice_cream" };
  }

  // DAIRY — yogurts, cheeses, milks, butters, creams. Subtype
  // narrows by which dairy token matched.
  if (/\b(dairy|dairies|yogurt|yogurts|yoghurt|cheese|cheeses|milk|milks|buttermilk|cream|butter|curd|kefir|quark|skyr)\b/.test(text)) {
    const dairySubtype =
      /\b(yogurt|yogurts|yoghurt|kefir|quark|skyr)\b/.test(text) ? "yogurt" :
      /\b(cheese|cheeses|curd)\b/.test(text)                     ? "cheese" :
      /\bbutter\b/.test(text)                                    ? "butter" :
      /\b(milk|milks|buttermilk|cream)\b/.test(text)             ? "milk"   :
      null;
    return { category: "dairy", tileId: "dairy", typeId: null, subtype: dairySubtype };
  }

  // SHELF-STABLE DAIRY — UHT milk in tetra packs, evaporated /
  // sweetened condensed milk in cans, powdered milk tins. Checked
  // BEFORE the general DAIRY branch (which routes to fridge). State
  // hint drives location-forcing in AddDraftSheet so the Parmalat
  // brik doesn't end up in the fridge tile.
  if (/\b(sweetened-condensed-milks?|condensed-milks?|evaporated-milks?|powdered-milks?|dried-milks?|milk-powders?|uht-milks?|shelf-stable-milks?|aseptic-milks?)\b/.test(text)) {
    const state =
      /\bsweetened-condensed|condensed-milks?\b/.test(text) ? "condensed" :
      /\bevaporated\b/.test(text)                           ? "evaporated" :
      /\bpowdered|dried-milks?|milk-powders?\b/.test(text)  ? "powdered" :
      "uht";
    return { category: "pantry", tileId: "shelf_stable_dairy", typeId: null, subtype: "milk", state };
  }

  // DRIED FRUIT & TRAIL MIX — raisins, dates, dried apricots /
  // mango / cranberries, sun-dried tomatoes, dried mushrooms.
  // Checked BEFORE general DAIRY and PRODUCE branches so the OFF
  // "dried-fruits" tag doesn't fall through to PRODUCE → fridge.
  // State hint drives the pantry forcing.
  if (/\b(dried-fruits?|raisins?|dates?|prunes?|dried-apricots?|dried-cranberries|dried-mangoe?s?|dried-figs?|sun-dried-tomatoes?|dried-mushrooms?|dried-vegetables?|trail-mix(es)?)\b/.test(text)) {
    return { category: "pantry", tileId: "dried_fruit", typeId: null, subtype: null, state: "dried" };
  }

  // PICKLED & FERMENTED — sealed pantry, opened fridge. Sauerkraut,
  // kimchi, pickles (cucumber-pickled), olives in jars, capers.
  // Checked BEFORE PRODUCE so a pickle jar doesn't land in fridge
  // produce alongside fresh cukes.
  if (/\b(pickles?|pickled-(vegetables?|cucumbers?|peppers?|onions?)|sauerkrauts?|kimchis?|fermented-(vegetables?|cabbages?)|olives?|capers?|gherkins?|kosher-dills?)\b/.test(text)) {
    const state = /\b(sauerkraut|kimchi|fermented)\b/.test(text) ? "fermented" : "pickled";
    return { category: "pantry", tileId: "pickles_ferments", typeId: null, subtype: null, state };
  }

  // CANNED MEATS & FISH — checked BEFORE jerky and general MEAT.
  // OFF tags this catches: canned-fish, canned-meats, canned-meat,
  // canned-tuna, canned-salmon, canned-sardines, canned-poultry,
  // prepared-meats, meat-pates, fish-pates, sardines, anchovies-in-
  // oil. Routes to pantry.canned_jarred with state=canned so the
  // shelf-life resolver hands back ~3 years sealed (vs. 5 days for
  // fresh fish). Sealed shelf-stable retort packs / cans behave
  // identically to canned beans / tomatoes from a storage POV.
  if (/\b(canned-(meat|meats|fish|tuna|salmon|sardines?|poultry|chicken|pork|beef)|prepared-meats?|meat-pates?|fish-pates?|tuna-in-(oil|water|brine)|sardines-in-(oil|water|brine|tomato-sauce)|anchovies-in-(oil|salt|brine))\b/.test(text)) {
    return { category: "pantry", tileId: "canned_jarred", typeId: null, subtype: null, state: "canned" };
  }

  // JERKY & SHELF-STABLE SNACK MEATS — checked BEFORE general MEAT
  // so a Slim Jim / Jack Link's / biltong product routes to pantry
  // jerky_snacks instead of fridge meat_poultry. The state hint
  // (jerky / cured / dried) lets the AddDraftSheet skip the chicken-
  // default state of "whole" and head straight to the preservation
  // form. Conservative match list — only the unambiguously shelf-
  // stable forms. Deli-section salami / prosciutto / pastrami stay
  // under the general MEAT branch since they're fridge-stored even
  // though they're technically cured.
  if (/\b(jerky|jerkies|dried-meat|dried-meats|dried-meat-products|cured-meat-stick|cured-meat-sticks|meat-stick|meat-sticks|meat-snack|meat-snacks|biltong|dry-sausage|dried-sausage)\b/.test(text)) {
    const state =
      /\bjerky|jerkies|meat-stick|meat-sticks|meat-snack|meat-snacks\b/.test(text) ? "jerky" :
      /\bbiltong|dried-meat\b/.test(text) ? "dried" :
      "cured";
    return { category: "pantry", tileId: "jerky_snacks", typeId: null, subtype: "snack_meat", state };
  }

  // MEAT & POULTRY. Subtype narrows by the specific token: deli /
  // sausage / chicken_cut / null (when the tag is just "meat").
  if (/\b(meat|meats|poultry|beef|pork|chicken|turkey|lamb|veal|duck|sausage|sausages|bacon|ham|salami|prosciutto|pastrami|deli|cold-cut)\b/.test(text)) {
    const meatSubtype =
      /\b(deli|cold-cut|salami|prosciutto|pastrami|ham|turkey|bacon)\b/.test(text) ? "deli"        :
      /\b(sausage|sausages)\b/.test(text)                                          ? "sausage"     :
      /\b(chicken|poultry)\b/.test(text)                                           ? "chicken_cut" :
      null;
    return { category: "meat", tileId: "meat_poultry", typeId: null, subtype: meatSubtype };
  }

  // SEAFOOD — grouped under meat category (mise's registry does the
  // same) but on its own fridge tile.
  if (/\b(fish|fishes|seafood|shellfish|shrimp|salmon|tuna|cod|halibut|crab|lobster|scallop|scallops|sardine|anchov|mussel|oyster|clam|tilapia|trout|mackerel|sushi)\b/.test(text)) {
    return { category: "meat", tileId: "seafood", typeId: null, subtype: null };
  }

  // PRODUCE — fresh fruits and vegetables.
  if (/\b(fruit|fruits|vegetable|vegetables|produce|berry|berries|leafy|greens|salad|apple|citrus|melon|stone-fruit)\b/.test(text)) {
    return { category: "produce", tileId: "produce", typeId: null, subtype: null };
  }

  // BAKING staples.
  if (/\b(baking|flour|flours|sugar|sugars|starch|starches|cornmeal|yeast|baking-powder|baking-soda|cocoa|chocolate-chip)\b/.test(text)) {
    const bakingSubtype = /\b(sugar|sugars)\b/.test(text) ? "sweetener" : "baking";
    return { category: "pantry", tileId: "baking", typeId: null, subtype: bakingSubtype };
  }

  // SAUCES & CONDIMENTS (shelf-stable defaults). After-open these
  // often move to the fridge, but for a fresh sealed package pantry
  // is the right first-state. Subtype narrows: dressing / condiment
  // / sauce based on which token matched.
  if (/\b(sauce|sauces|condiment|condiments|ketchup|mustard|mayonnaise|mayo|vinegar|vinegars|dressing|dressings|marinade|salsa|hot-sauce|soy-sauce)\b/.test(text)) {
    const sauceSubtype =
      /\b(dressing|dressings)\b/.test(text)                                       ? "dressing"  :
      /\b(mustard|mayonnaise|mayo|condiment|condiments)\b/.test(text)             ? "condiment" :
      "sauce";
    return { category: "pantry", tileId: "condiments_sauces", typeId: null, subtype: sauceSubtype };
  }

  // PASTA, GRAINS, CEREALS. Subtype = cereal when the cereal token
  // matched, otherwise null (no pasta/grain subtype yet).
  if (/\b(pasta|pastas|noodle|noodles|spaghetti|rice|rices|cereal|cereals|oat|oats|quinoa|couscous|bulgur|grain|grains)\b/.test(text)) {
    const grainSubtype = /\b(cereal|cereals)\b/.test(text) ? "cereal" : null;
    return { category: "pantry", tileId: "pasta_grains", typeId: null, subtype: grainSubtype };
  }

  // BEANS & LEGUMES.
  if (/\b(bean|beans|lentil|lentils|chickpea|chickpeas|legume|legumes)\b/.test(text)) {
    return { category: "pantry", tileId: "beans_legumes", typeId: null, subtype: null };
  }

  // SNACKS & CRACKERS. Subtype narrows by the specific snack token.
  if (/\b(snack|snacks|cracker|crackers|chip|chips|pretzel|pretzels|popcorn|trail-mix|granola-bar)\b/.test(text)) {
    const snackSubtype = /\b(cracker|crackers)\b/.test(text) ? "cracker" : null;
    return { category: "pantry", tileId: "canned_jarred", typeId: null, subtype: snackSubtype };
  }

  // CANNED & JARRED (tomatoes, beans in cans, jars, preserves).
  if (/\b(canned|jarred|preserved|pickled|preserve|jam|jelly|marmalade)\b/.test(text)) {
    return { category: "pantry", tileId: "canned_jarred", typeId: null, subtype: null };
  }

  // OILS & FATS.
  if (/\b(oil|oils|olive-oil|cooking-oil|vegetable-oil|shortening|lard)\b/.test(text)) {
    return { category: "pantry", tileId: "oils_fats", typeId: null, subtype: null };
  }

  // SPICES & DRIED HERBS.
  if (/\b(spice|spices|dried-herb|dried-herbs|seasoning|seasonings)\b/.test(text)) {
    return { category: "pantry", tileId: "spices_dried_herbs", typeId: null, subtype: null };
  }

  // NUTS & SEEDS.
  if (/\b(nut|nuts|seed|seeds|almond|almonds|peanut|peanuts|cashew|cashews|walnut|walnuts|pistachio|pistachios|pecan|pecans)\b/.test(text)) {
    return { category: "pantry", tileId: "nuts_seeds", typeId: null, subtype: null };
  }

  // BREAD & BAKED GOODS.
  if (/\b(bread|breads|loaf|baguette|tortilla|tortillas|pita|naan|bagel|bagels|bun|buns|roll|rolls)\b/.test(text)) {
    return { category: "pantry", tileId: "bread", typeId: null, subtype: "bread" };
  }

  // SWEETS & CONFECTIONERY. Subtype narrows by the specific token —
  // cookie / candy / chocolate. This is the load-bearing branch for
  // the M&M's-on-cookie / Hershey's-on-cookie inclusion-licensor
  // demotion when an unknown SKU's only signal is OFF tags.
  if (/\b(sweet|candies|candy|chocolate|chocolates|confection|cookie|cookies|dessert)\b/.test(text)) {
    // Order matters: prefer "candy" over "chocolate" when both are
    // present so "chocolate-candy-bars" resolves as candy (which is
    // what the picker treats as the inclusion-licensor subtype) and
    // not as chocolate (which would let M&M's pass the subtype gate
    // on a chocolate-flagged candy SKU).
    const sweetSubtype =
      /\b(cookie|cookies)\b/.test(text)            ? "cookie"    :
      /\b(candy|candies|confection)\b/.test(text)  ? "candy"     :
      /\b(chocolate|chocolates)\b/.test(text)      ? "chocolate" :
      null;
    return { category: "pantry", tileId: "sweeteners", typeId: null, subtype: sweetSubtype };
  }

  return { category: null, tileId: null, typeId: null, subtype: null };
}
