# Icon swap reference

Drop hand-drawn SVGs into these paths to override emoji on the canonical / tile surfaces.

Convention:
- **Canonical icons**: `public/icons/<canonical_id>.svg`. After dropping the file, register the slug in `src/lib/canonicalIcons.js` → `BUNDLED_ICON_SLUGS`.
- **Tile icons**: `public/icons/tiles/<tile_id>.svg`. Register in `src/lib/canonicalIcons.js` → `BUNDLED_TILE_SLUGS`. For per-location `misc`, prefix with the location: `fridge_misc` / `pantry_misc` / `freezer_misc`.

Slugs use lowercase + underscores. Match exactly.

## STORED IN tiles

### Fridge

| File | Slug | Emoji | Label |
|------|------|-------|-------|
| public/icons/tiles/meat_poultry.svg | `meat_poultry` | 🥩 | Meat & Poultry |
| public/icons/tiles/seafood.svg | `seafood` | 🐟 | Seafood |
| public/icons/tiles/dairy.svg | `dairy` | 🧀 | Dairy & Eggs |
| public/icons/tiles/produce.svg | `produce` | 🥦 | Produce |
| public/icons/tiles/fresh_herbs.svg | `fresh_herbs` | 🌿 | Fresh Herbs |
| public/icons/tiles/condiments.svg | `condiments` | 🫙 | Condiments & Sauces |
| public/icons/tiles/drinks.svg | `drinks` | 🥤 | Drinks |
| public/icons/tiles/bread_baked.svg | `bread_baked` | 🥖 | Bread & Baked |
| public/icons/tiles/leftovers.svg | `leftovers` | 🍱 | Leftovers |
| public/icons/tiles/misc.svg | `misc` | 📦 | Miscellaneous |

### Pantry

| File | Slug | Emoji | Label |
|------|------|-------|-------|
| public/icons/tiles/pasta_grains.svg | `pasta_grains` | 🍝 | Pasta & Grains |
| public/icons/tiles/beans_legumes.svg | `beans_legumes` | 🫘 | Beans & Legumes |
| public/icons/tiles/canned_jarred.svg | `canned_jarred` | 🥫 | Canned & Jarred |
| public/icons/tiles/baking.svg | `baking` | 🌾 | Baking |
| public/icons/tiles/spices_dried_herbs.svg | `spices_dried_herbs` | 🧂 | Spices & Dried Herbs |
| public/icons/tiles/condiments_sauces.svg | `condiments_sauces` | 🫙 | Condiments & Sauces |
| public/icons/tiles/oils_fats.svg | `oils_fats` | 🧈 | Oils & Fats |
| public/icons/tiles/sweeteners.svg | `sweeteners` | 🍯 | Sweeteners |
| public/icons/tiles/nuts_seeds.svg | `nuts_seeds` | 🥜 | Nuts & Seeds |
| public/icons/tiles/cooking_alcohol.svg | `cooking_alcohol` | 🍷 | Cooking Alcohol |
| public/icons/tiles/bread.svg | `bread` | 🍞 | Bread |
| public/icons/tiles/dried_chilies.svg | `dried_chilies` | 🌶️ | Dried Chilies |
| public/icons/tiles/misc.svg | `misc` | 📦 | Miscellaneous |

### Freezer

| File | Slug | Emoji | Label |
|------|------|-------|-------|
| public/icons/tiles/frozen_meat_poultry.svg | `frozen_meat_poultry` | 🥩 | Meat & Poultry |
| public/icons/tiles/frozen_seafood.svg | `frozen_seafood` | 🐟 | Seafood |
| public/icons/tiles/frozen_stocks_sauces.svg | `frozen_stocks_sauces` | 🫙 | Stocks & Sauces |
| public/icons/tiles/frozen_veg.svg | `frozen_veg` | 🌽 | Vegetables |
| public/icons/tiles/frozen_fruit.svg | `frozen_fruit` | 🍓 | Fruit |
| public/icons/tiles/frozen_bread_dough.svg | `frozen_bread_dough` | 🍞 | Bread & Dough |
| public/icons/tiles/frozen_meal_prep.svg | `frozen_meal_prep` | 🍱 | Meal Prep |
| public/icons/tiles/frozen_desserts.svg | `frozen_desserts` | 🧁 | Desserts |
| public/icons/tiles/frozen_butter_dairy.svg | `frozen_butter_dairy` | 🧈 | Butter & Dairy |
| public/icons/tiles/frozen_herbs.svg | `frozen_herbs` | 🌿 | Fresh Herbs Frozen |
| public/icons/tiles/misc.svg | `misc` | 📦 | Miscellaneous |

## Canonical ingredients

Grouped by category. Files go at `public/icons/<slug>.svg`. Slug is the `id` column.

### dairy (90)

| Slug | Emoji | Name |
|------|-------|------|
| `abondance` | 🧀 | Abondance |
| `aged_cheddar` | 🧀 | Aged Cheddar |
| `aged_gouda` | 🧀 | Aged Gouda |
| `almond_milk` | 🥛 | Almond Milk |
| `appenzeller` | 🧀 | Appenzeller |
| `asiago` | 🧀 | Asiago |
| `beaufort` | 🧀 | Beaufort |
| `bleu_dauvergne` | 🧀 | Bleu d'Auvergne |
| `brick_cheese` | 🧀 | Brick |
| `brie` | 🧀 | Brie |
| `brillat_savarin` | 🧀 | Brillat-Savarin |
| `burrata` | 🧀 | Burrata |
| `butter` | 🧈 | Unsalted Butter |
| `butterkase` | 🧀 | Butterkäse |
| `buttermilk` | 🥛 | Buttermilk |
| `cabrales` | 🧀 | Cabrales |
| `cambozola` | 🧀 | Cambozola |
| `camembert` | 🧀 | Camembert |
| `cashel_blue` | 🧀 | Cashel Blue |
| `cheddar` | 🧀 | Cheddar |
| `colby` | 🧀 | Colby |
| `comte` | 🧀 | Comté |
| `cottage_cheese` | 🥛 | Cottage Cheese |
| `cougar_gold` | 🧀 | Cougar Gold |
| `coulommiers` | 🧀 | Coulommiers |
| `cream_cheese` | 🧀 | Cream Cheese |
| `edam` | 🧀 | Edam |
| `eggs` | 🥚 | Eggs |
| `emmental` | 🧀 | Emmental |
| `epoisses` | 🧀 | Époisses |
| `explorateur` | 🧀 | Explorateur |
| `feta` | 🧀 | Feta |
| `fontina` | 🧀 | Fontina |
| `fromage_blanc` | 🧀 | Fromage Blanc |
| `goat_cheese` | 🧀 | Goat Cheese |
| `gorgonzola` | 🧀 | Gorgonzola |
| `gouda` | 🧀 | Gouda |
| `grana_padano` | 🧀 | Grana Padano |
| `greek_yogurt` | 🥛 | Greek Yogurt |
| `gruyere` | 🧀 | Gruyère |
| `half_and_half` | 🥛 | Half & Half |
| `havarti` | 🧀 | Havarti |
| `heavy_cream` | 🥛 | Heavy Cream |
| `humboldt_fog` | 🧀 | Humboldt Fog |
| `idiazabal` | 🧀 | Idiazábal |
| `jarlsberg` | 🧀 | Jarlsberg |
| `langres` | 🧀 | Langres |
| `limburger` | 🧀 | Limburger |
| `manchego` | 🧀 | Manchego |
| `mascarpone` | 🧀 | Mascarpone |
| `maytag_blue` | 🧀 | Maytag Blue |
| `milk` | 🥛 | Whole Milk |
| `milk_2pct` | 🥛 | 2% Milk |
| `milk_skim` | 🥛 | Skim Milk |
| `mimolette` | 🧀 | Mimolette |
| `monterey_jack` | 🧀 | Monterey Jack |
| `mozzarella` | 🧀 | Fresh Mozzarella |
| `muenster` | 🧀 | Muenster |
| `oat_milk` | 🥛 | Oat Milk |
| `oj` | 🧃 | Orange Juice |
| `paneer` | 🧀 | Paneer |
| `parmesan` | 🧀 | Parmesan |
| `parmigiano` | 🧀 | Parmigiano-Reggiano |
| `pecorino` | 🧀 | Pecorino Romano |
| `pepper_jack` | 🧀 | Pepper Jack |
| `piave` | 🧀 | Piave |
| `port_salut` | 🧀 | Port Salut |
| `provolone` | 🧀 | Provolone |
| `quark` | 🧀 | Quark |
| `queso_fresco` | 🧀 | Queso Fresco |
| `raclette` | 🧀 | Raclette |
| `ricotta` | 🧀 | Ricotta |
| `roquefort` | 🧀 | Roquefort |
| `saint_andre` | 🧀 | Saint-André |
| `sbrinz` | 🧀 | Sbrinz |
| `scamorza` | 🧀 | Scamorza |
| `smoked_cheddar` | 🧀 | Smoked Cheddar |
| `smoked_gouda` | 🧀 | Smoked Gouda |
| `smoked_mozz` | 🧀 | Smoked Mozzarella |
| `sour_cream` | 🥛 | Sour Cream |
| `spreadable_cheese` | 🧀 | Spreadable Cheese |
| `stilton` | 🧀 | Stilton |
| `stinking_bishop` | 🧀 | Stinking Bishop |
| `stracchino` | 🧀 | Stracchino |
| `taleggio` | 🧀 | Taleggio |
| `teleme` | 🧀 | Teleme |
| `tomme_savoie` | 🧀 | Tomme de Savoie |
| `vacherin_frib` | 🧀 | Vacherin Fribourgeois |
| `vacherin_mdor` | 🧀 | Vacherin Mont d'Or |
| `yogurt` | 🥛 | Plain Yogurt |

### meat (35)

| Slug | Emoji | Name |
|------|-------|------|
| `bacon` | 🥓 | Bacon / Pancetta |
| `beef` | 🥩 | Beef |
| `brisket` | 🥩 | Brisket |
| `chicken` | 🍗 | Chicken |
| `chicken_breast` | 🍗 | Chicken Breast |
| `chicken_leg` | 🍗 | Chicken Legs |
| `chicken_thigh` | 🍗 | Chicken Thighs |
| `chicken_wing` | 🍗 | Chicken Wings |
| `chuck_roast` | 🥩 | Chuck Roast |
| `cod` | 🐟 | Cod |
| `deli_turkey` | 🦃 | Sliced Turkey (deli) |
| `ground_beef` | 🥩 | Ground Beef |
| `ground_pork` | 🥩 | Ground Pork |
| `ground_turkey` | 🦃 | Ground Turkey |
| `guanciale` | 🥓 | Guanciale |
| `ham` | 🥩 | Ham |
| `hot_dog` | 🌭 | Hot Dog |
| `ny_strip` | 🥩 | NY Strip |
| `pork` | 🥩 | Pork |
| `pork_chop` | 🥩 | Pork Chops |
| `pork_loin` | 🥩 | Pork Loin |
| `pork_shoulder` | 🥩 | Pork Shoulder |
| `prosciutto` | 🥓 | Prosciutto |
| `ribeye` | 🥩 | Ribeye |
| `salami` | 🥩 | Salami |
| `salmon` | 🐟 | Salmon |
| `sausage` | 🌭 | Sausage |
| `scallops` | 🦪 | Scallops |
| `shrimp` | 🍤 | Shrimp |
| `sirloin` | 🥩 | Sirloin |
| `steak` | 🥩 | Steak |
| `tilapia` | 🐟 | Tilapia |
| `tuna` | 🐟 | Tuna (fresh) |
| `turkey` | 🦃 | Turkey |
| `turkey_breast` | 🦃 | Turkey Breast |

### pantry (166)

| Slug | Emoji | Name |
|------|-------|------|
| `allspice` | 🟤 | Allspice |
| `almond_flour` | 🌰 | Almond Flour |
| `angel_hair` | 🍝 | Angel Hair |
| `annatto` | 🟠 | Annatto Seeds |
| `arborio_rice` | 🍚 | Arborio Rice |
| `bagel` | 🥯 | Bagels |
| `baguette` | 🥖 | Baguette |
| `balsamic` | 🍶 | Balsamic Vinegar |
| `basmati_rice` | 🍚 | Basmati Rice |
| `bay_leaves` | 🍃 | Bay Leaves |
| `beef_stock` | 🍲 | Beef Stock |
| `berbere` | 🌶️ | Berbere |
| `black_beans` | 🫘 | Black Beans |
| `black_pepper` | 🫚 | Black Pepper |
| `black_sesame` | 🫘 | Black Sesame Seeds |
| `bread` | 🍞 | Sandwich Bread |
| `bread_flour` | 🌾 | Bread Flour |
| `brown_rice` | 🍚 | Brown Rice |
| `bucatini` | 🍝 | Bucatini |
| `cajun_seasoning` | 🌶️ | Cajun Seasoning |
| `cake_flour` | 🌾 | Cake Flour |
| `canned_tomatoes` | 🥫 | Canned Tomatoes |
| `cannellini_beans` | 🫘 | Cannellini Beans |
| `caraway_seed` | 🧂 | Caraway Seeds |
| `cardamom` | 🟢 | Cardamom |
| `cavatappi` | 🍝 | Cavatappi |
| `cayenne` | 🌶️ | Cayenne Pepper |
| `celery_salt` | 🧂 | Celery Salt |
| `celery_seed` | 🧂 | Celery Seed |
| `chicken_stock` | 🍲 | Chicken Stock |
| `chickpeas` | 🫘 | Chickpeas |
| `chili_powder` | 🌶️ | Chili Powder |
| `ciabatta` | 🍞 | Ciabatta / Focaccia |
| `cinnamon` | 🟤 | Cinnamon |
| `cloves` | 🟤 | Cloves |
| `coconut_flour` | 🥥 | Coconut Flour |
| `coffee` | ☕ | Coffee (whole bean) |
| `coriander` | 🟤 | Ground Coriander |
| `cornmeal` | 🌽 | Cornmeal |
| `cream_of_tartar` | 🧂 | Cream of Tartar |
| `cumin` | 🟤 | Cumin |
| `cumin_seed` | 🟤 | Cumin Seeds |
| `curry_powder` | 🟡 | Curry Powder |
| `dijon` | 🟡 | Dijon Mustard |
| `dried_basil` | 🌿 | Dried Basil |
| `dried_chives` | 🌿 | Dried Chives |
| `dried_dill` | 🌿 | Dried Dill |
| `dried_marjoram` | 🌿 | Dried Marjoram |
| `dried_mint` | 🌿 | Dried Mint |
| `dried_oregano` | 🌿 | Dried Oregano |
| `dried_parsley` | 🌿 | Dried Parsley |
| `dried_rosemary` | 🌿 | Dried Rosemary |
| `dried_sage` | 🌿 | Dried Sage |
| `dried_tarragon` | 🌿 | Dried Tarragon |
| `dried_thyme` | 🌿 | Dried Thyme |
| `dukkah` | 🥜 | Dukkah |
| `english_muffin` | 🍞 | English Muffins |
| `everything_bagel` | 🥯 | Everything Bagel Seasoning |
| `farfalle` | 🍝 | Farfalle |
| `fennel_seed` | 🟢 | Fennel Seeds |
| `fenugreek` | 🧂 | Fenugreek |
| `fettuccine` | 🍝 | Fettuccine |
| `fish_sauce` | 🐟 | Fish Sauce |
| `five_spice` | 🧂 | Chinese Five Spice |
| `flaky_salt` | 🧂 | Flaky Salt |
| `flour` | 🌾 | All-Purpose Flour |
| `furikake` | 🍚 | Furikake |
| `fusilli` | 🍝 | Fusilli |
| `garam_masala` | 🟤 | Garam Masala |
| `garlic_powder` | 🧄 | Garlic Powder |
| `garlic_salt` | 🧂 | Garlic Salt |
| `ginger_powder` | 🫚 | Ground Ginger |
| `gnocchi` | 🍝 | Gnocchi |
| `ground_cinnamon` | 🟤 | Ground Cinnamon |
| `ground_coriander` | 🟤 | Ground Coriander Seeds |
| `ground_cumin` | 🟤 | Ground Cumin |
| `ground_mustard` | 🟡 | Ground Mustard |
| `herbs_de_provence` | 🌿 | Herbes de Provence |
| `hoisin` | 🥢 | Hoisin Sauce |
| `honey` | 🍯 | Honey |
| `hot_sauce` | 🌶️ | Hot Sauce |
| `italian_seasoning` | 🌿 | Italian Seasoning |
| `jasmine_rice` | 🍚 | Jasmine Rice |
| `jerk_seasoning` | 🌶️ | Jerk Seasoning |
| `juniper_berries` | 🫐 | Juniper Berries |
| `ketchup` | 🥫 | Ketchup |
| `kidney_beans` | 🫘 | Kidney Beans |
| `kosher_salt` | 🧂 | Kosher Salt |
| `lasagna` | 🍝 | Lasagna Noodles |
| `lemon_pepper` | 🍋 | Lemon Pepper |
| `lentils` | 🫘 | Lentils |
| `linguine` | 🍝 | Linguine |
| `macaroni` | 🍝 | Elbow Macaroni |
| `mace` | 🧂 | Mace |
| `maple_syrup` | 🍁 | Maple Syrup |
| `masa_harina` | 🌽 | Masa Harina |
| `mayo` | 🥚 | Mayonnaise |
| `mirin` | 🍶 | Mirin |
| `miso` | 🍲 | Miso Paste |
| `msg` | 🧂 | MSG |
| `mustard` | 🟡 | Yellow Mustard |
| `mustard_seed` | 🟡 | Mustard Seeds |
| `nori` | 🍙 | Nori |
| `nutmeg` | 🟤 | Nutmeg |
| `oats` | 🌾 | Rolled Oats |
| `old_bay` | 🦀 | Old Bay Seasoning |
| `olive_oil` | 🫒 | Olive Oil |
| `onion_powder` | 🧅 | Onion Powder |
| `onion_salt` | 🧂 | Onion Salt |
| `orecchiette` | 🍝 | Orecchiette |
| `oregano` | 🌿 | Oregano |
| `orzo` | 🍝 | Orzo |
| `oyster_sauce` | 🦪 | Oyster Sauce |
| `paprika` | 🟠 | Paprika |
| `pasta` | 🍝 | Pasta |
| `pastry_flour` | 🌾 | Pastry Flour |
| `peanut_butter` | 🥜 | Peanut Butter |
| `penne` | 🍝 | Penne |
| `peppercorns` | ⚫ | Peppercorns |
| `pesto` | 🌿 | Pesto |
| `pinto_beans` | 🫘 | Pinto Beans |
| `poppy_seed` | 🌸 | Poppy Seeds |
| `quinoa` | 🌾 | Quinoa |
| `ramen` | 🍜 | Ramen |
| `ranch_seasoning` | 🥗 | Ranch Seasoning |
| `ras_el_hanout` | 🧂 | Ras el Hanout |
| `ravioli` | 🍝 | Ravioli |
| `red_pepper_flakes` | 🌶️ | Red Pepper Flakes |
| `red_wine` | 🍷 | Red Wine |
| `rice` | 🍚 | White Rice |
| `rice_flour` | 🌾 | Rice Flour |
| `rice_noodles` | 🍜 | Rice Noodles |
| `rigatoni` | 🍝 | Rigatoni |
| `rotini` | 🍝 | Rotini |
| `saffron` | 🌸 | Saffron |
| `sea_salt` | 🧂 | Sea Salt |
| `seasoned_salt` | 🧂 | Seasoned Salt |
| `semolina` | 🌾 | Semolina Flour |
| `smoked_paprika` | 🟠 | Smoked Paprika |
| `smoked_salt` | 🧂 | Smoked Salt |
| `soba` | 🍜 | Soba |
| `sourdough` | 🍞 | Sourdough |
| `soy_sauce` | 🍶 | Soy Sauce |
| `spaghetti` | 🍝 | Spaghetti |
| `sriracha` | 🌶️ | Sriracha |
| `star_anise` | ⭐ | Star Anise |
| `sugar` | 🍬 | Sugar |
| `sumac` | 🟣 | Sumac |
| `sweet_paprika` | 🟠 | Sweet Paprika |
| `table_salt` | 🧂 | Table Salt |
| `taco_seasoning` | 🌮 | Taco Seasoning |
| `togarashi` | 🌶️ | Shichimi Togarashi |
| `tomato_paste` | 🍅 | Tomato Paste |
| `tortellini` | 🍝 | Tortellini |
| `tortillas` | 🌮 | Tortillas |
| `truffle_salt` | 🧂 | Truffle Salt |
| `turmeric` | 🟡 | Turmeric |
| `udon` | 🍜 | Udon |
| `vinegar` | 🍶 | Vinegar |
| `white_pepper` | ⚪ | White Pepper |
| `white_sesame` | 🫘 | White Sesame Seeds |
| `white_wine` | 🍷 | White Wine / Sherry |
| `whole_wheat_flour` | 🌾 | Whole Wheat Flour |
| `zaatar` | 🌿 | Za'atar |
| `zero_zero_flour` | 🌾 | 00 Flour |
| `ziti` | 🍝 | Ziti |

### produce (31)

| Slug | Emoji | Name |
|------|-------|------|
| `apple` | 🍎 | Apple |
| `arugula` | 🥬 | Arugula |
| `avocado` | 🥑 | Avocado |
| `banana` | 🍌 | Banana |
| `basil` | 🌿 | Fresh Basil |
| `bell_pepper` | 🫑 | Bell Pepper |
| `blueberry` | 🫐 | Blueberries |
| `broccoli` | 🥦 | Broccoli |
| `carrot` | 🥕 | Carrot |
| `cauliflower` | 🥦 | Cauliflower |
| `cilantro` | 🌿 | Cilantro |
| `cucumber` | 🥒 | Cucumber |
| `garlic` | 🧄 | Garlic |
| `ginger` | 🫚 | Ginger |
| `green_onion` | 🌱 | Green Onion |
| `kale` | 🥬 | Kale |
| `lemon` | 🍋 | Lemon |
| `lettuce` | 🥬 | Lettuce |
| `lime` | 🍋 | Lime |
| `mushroom` | 🍄 | Cremini Mushrooms |
| `orange` | 🍊 | Orange |
| `parsley` | 🌿 | Parsley |
| `pearl_onion` | 🧅 | Pearl Onions |
| `potato` | 🥔 | Potato |
| `shallot` | 🧅 | Shallot |
| `spinach` | 🥬 | Baby Spinach |
| `strawberry` | 🍓 | Strawberries |
| `sweet_potato` | 🍠 | Sweet Potato |
| `tomato` | 🍅 | Tomato |
| `yellow_onion` | 🧅 | Yellow Onion |
| `zucchini` | 🥒 | Zucchini |
