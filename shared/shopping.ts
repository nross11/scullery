import { fromBase, normalizeName, tidyAmount, toBase } from './ingredients';
import type { Ingredient } from './recipe';

export interface PlannedIngredient {
  ingredient: Ingredient;
  factor: number; // servings scaling for this plan entry
  recipeTitle: string;
}

export interface ShoppingLine {
  name: string;
  quantity: number | null;
  unit: string | null;
  aisle: string;
  sources: string[];
}

const AISLES: [string, RegExp][] = [
  ['Produce', /\b(onion|garlic|shallot|scallion|leek|carrot|celery|potato|tomato|pepper|chil[ei]|lettuce|spinach|kale|cabbage|broccoli|cauliflower|zucchini|courgette|cucumber|mushroom|lemon|lime|orange|apple|banana|berr|avocado|ginger|herb|parsley|cilantro|coriander|basil|mint|thyme|rosemary|dill|sage|chive|squash|pumpkin|aubergine|eggplant|corn|pea|bean sprout|lemongrass|fruit|vegetable|salad|arugula|rocket)/],
  ['Meat & fish', /\b(chicken|beef|pork|lamb|turkey|bacon|sausage|mince|steak|prosciutto|ham|chorizo|fish|salmon|tuna|cod|prawn|shrimp|anchov|crab|mussel|clam|scallop)/],
  ['Dairy & eggs', /\b(milk|butter|cream|cheese|yogurt|yoghurt|egg|parmesan|mozzarella|cheddar|feta|ricotta|creme fraiche|sour cream|ghee)/],
  ['Bakery', /\b(bread|bun|roll|tortilla|pita|naan|baguette|brioche|bagel|wrap)\b/],
  ['Pantry', /\b(flour|sugar|salt|pepper|oil|vinegar|rice|pasta|noodle|spaghetti|oat|stock|broth|bouillon|honey|syrup|baking|yeast|cocoa|chocolate|vanilla|soy|sauce|paste|mustard|ketchup|mayo|lentil|chickpea|bean|tin|can|nut|almond|peanut|cashew|seed|raisin|coconut|cornstarch|cornflour|breadcrumb|panko|spice|cumin|paprika|cinnamon|nutmeg|turmeric|oregano|chilli flake|curry|stock cube|tahini|miso|sesame)/],
  ['Frozen', /\b(frozen|ice cream)/],
  ['Drinks', /\b(wine|beer|juice|soda|coffee|tea)\b/],
];

export function guessAisle(name: string): string {
  const n = name.toLowerCase();
  // Check "black pepper"/"salt" before produce's "pepper"
  if (/\b(black pepper|white pepper|peppercorn|salt|stock|broth|oil|vinegar|tinned|canned|dried)\b/.test(n)) return 'Pantry';
  for (const [aisle, re] of AISLES) if (re.test(n)) return aisle;
  return 'Other';
}

export const AISLE_ORDER = ['Produce', 'Meat & fish', 'Dairy & eggs', 'Bakery', 'Pantry', 'Frozen', 'Drinks', 'Other'];

/**
 * Combine ingredients across planned recipes. Same normalized name and compatible
 * unit family -> one line. Different/unknown units stay separate lines.
 */
export function buildShoppingList(items: PlannedIngredient[]): ShoppingLine[] {
  const map = new Map<string, ShoppingLine & { preferred: string | null; base: number | null }>();
  for (const { ingredient: ing, factor, recipeTitle } of items) {
    const key0 = normalizeName(ing.name);
    if (!key0) continue;
    const scaled = ing.quantity !== null ? ing.quantity * factor : null;
    const base = scaled !== null ? toBase(scaled, ing.unit) : null;
    const key = `${key0}|${base ? base.unit ?? '' : 'none'}`;
    const existing = map.get(key);
    if (existing) {
      if (base && existing.base !== null) existing.base += base.q;
      if (!existing.sources.includes(recipeTitle)) existing.sources.push(recipeTitle);
    } else {
      map.set(key, {
        name: ing.name,
        quantity: null,
        unit: base?.unit ?? null,
        aisle: guessAisle(ing.name),
        sources: [recipeTitle],
        preferred: ing.unit,
        base: base ? base.q : null,
      });
    }
  }
  const out: ShoppingLine[] = [];
  for (const line of map.values()) {
    let quantity: number | null = null;
    let unit: string | null = line.unit;
    if (line.base !== null) {
      const base = fromBase(line.base, line.unit, line.preferred);
      const disp = tidyAmount(base.q, base.unit);
      quantity = Math.round(disp.q * 100) / 100;
      unit = disp.unit;
    }
    out.push({ name: line.name, quantity, unit, aisle: line.aisle, sources: line.sources });
  }
  out.sort((a, b) => AISLE_ORDER.indexOf(a.aisle) - AISLE_ORDER.indexOf(b.aisle) || a.name.localeCompare(b.name));
  return out;
}
