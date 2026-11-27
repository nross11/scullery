import type { Ingredient } from './recipe';

const UNICODE_FRACTIONS: Record<string, number> = {
  '¼': 0.25, '½': 0.5, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125,
  '⅜': 0.375, '⅝': 0.625, '⅞': 0.875, '⅕': 0.2, '⅙': 1 / 6,
};

/** Canonical unit -> aliases */
const UNIT_ALIASES: Record<string, string[]> = {
  tsp: ['tsp', 'tsps', 'teaspoon', 'teaspoons', 't'],
  tbsp: ['tbsp', 'tbsps', 'tbs', 'tablespoon', 'tablespoons', 'tbl', 'T'],
  cup: ['cup', 'cups', 'c'],
  ml: ['ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres', 'mls'],
  l: ['l', 'liter', 'liters', 'litre', 'litres'],
  g: ['g', 'gram', 'grams', 'gr', 'grs'],
  kg: ['kg', 'kgs', 'kilogram', 'kilograms'],
  oz: ['oz', 'ounce', 'ounces'],
  'fl oz': ['fl oz', 'fl. oz', 'fluid ounce', 'fluid ounces'],
  lb: ['lb', 'lbs', 'pound', 'pounds'],
  pinch: ['pinch', 'pinches'],
  clove: ['clove', 'cloves'],
  can: ['can', 'cans', 'tin', 'tins'],
  stick: ['stick', 'sticks'],
  bunch: ['bunch', 'bunches'],
  slice: ['slice', 'slices'],
  piece: ['piece', 'pieces'],
  package: ['package', 'packages', 'pkg', 'packet', 'packets'],
  handful: ['handful', 'handfuls'],
  sprig: ['sprig', 'sprigs'],
  quart: ['quart', 'quarts', 'qt'],
  pint: ['pint', 'pints', 'pt'],
};

const UNIT_LOOKUP = new Map<string, string>();
for (const [canon, aliases] of Object.entries(UNIT_ALIASES)) {
  for (const a of aliases) UNIT_LOOKUP.set(a === 'T' ? a : a.toLowerCase(), canon);
}

function parseNumberToken(tok: string): number | null {
  tok = tok.trim();
  if (!tok) return null;
  // "1½"
  const uni = tok.match(/^(\d+)?\s*([¼½¾⅓⅔⅛⅜⅝⅞⅕⅙])$/);
  if (uni) return (uni[1] ? parseInt(uni[1], 10) : 0) + UNICODE_FRACTIONS[uni[2]];
  const frac = tok.match(/^(\d+)\/(\d+)$/);
  if (frac) return parseInt(frac[2], 10) ? parseInt(frac[1], 10) / parseInt(frac[2], 10) : null;
  if (/^\d+([.,]\d+)?$/.test(tok)) return parseFloat(tok.replace(',', '.'));
  return null;
}

const QTY_RE =
  /^((?:\d+\s+\d+\/\d+)|(?:\d+\/\d+)|(?:\d*\s*[¼½¾⅓⅔⅛⅜⅝⅞⅕⅙])|(?:\d+(?:[.,]\d+)?))(?:\s*(?:-|–|to)\s*((?:\d+\s+\d+\/\d+)|(?:\d+\/\d+)|(?:\d*\s*[¼½¾⅓⅔⅛⅜⅝⅞⅕⅙])|(?:\d+(?:[.,]\d+)?)))?/;

function parseQty(s: string): number | null {
  const mixed = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return parseInt(mixed[1], 10) + parseInt(mixed[2], 10) / parseInt(mixed[3], 10);
  return parseNumberToken(s.replace(/\s+/g, ''));
}

/** Parse a free-text ingredient line into structured parts. Best effort. */
export function parseIngredient(raw: string): Ingredient {
  const text = raw.replace(/\s+/g, ' ').trim();
  let rest = text.replace(/^[-•*▢□]\s*/, '');
  let quantity: number | null = null;
  let quantityMax: number | null = null;
  let unit: string | null = null;

  const m = rest.match(QTY_RE);
  if (m && m[0].trim()) {
    quantity = parseQty(m[1]);
    if (m[2]) quantityMax = parseQty(m[2]);
    rest = rest.slice(m[0].length).trim();
  }

  // Unit: try two-word ("fl oz") then one-word. Allow "g" glued to number already stripped.
  if (quantity !== null) {
    const two = rest.match(/^([a-zA-Z.]+\s[a-zA-Z.]+)\b\.?/);
    const one = rest.match(/^([a-zA-Z]+)\b\.?/);
    if (two && UNIT_LOOKUP.has(two[1].toLowerCase().replace(/\./g, ''))) {
      unit = UNIT_LOOKUP.get(two[1].toLowerCase().replace(/\./g, ''))!;
      rest = rest.slice(two[0].length).trim();
    } else if (one) {
      const key = one[1] === 'T' ? 'T' : one[1].toLowerCase();
      if (UNIT_LOOKUP.has(key)) {
        unit = UNIT_LOOKUP.get(key)!;
        rest = rest.slice(one[0].length).trim();
      }
    }
    rest = rest.replace(/^of\s+/i, '');
  }

  let note: string | null = null;
  const paren = rest.match(/\(([^)]*)\)/);
  if (paren) {
    note = paren[1].trim();
    rest = (rest.slice(0, paren.index) + rest.slice(paren.index! + paren[0].length)).trim();
  }
  const comma = rest.indexOf(',');
  if (comma > 0) {
    const after = rest.slice(comma + 1).trim();
    note = note ? `${after}; ${note}` : after;
    rest = rest.slice(0, comma).trim();
  }

  return { text, quantity, quantityMax, unit, name: rest || text, note };
}

/** Pretty-print a quantity using common fractions. */
export function formatQuantity(q: number): string {
  const whole = Math.floor(q + 1e-9);
  const frac = q - whole;
  const fracs: [number, string][] = [
    [0, ''], [0.125, '⅛'], [0.25, '¼'], [1 / 3, '⅓'], [0.375, '⅜'], [0.5, '½'],
    [0.625, '⅝'], [2 / 3, '⅔'], [0.75, '¾'], [0.875, '⅞'], [1, ''],
  ];
  if (whole >= 10) return String(Math.round(q));
  let best = fracs[0];
  for (const f of fracs) if (Math.abs(frac - f[0]) < Math.abs(frac - best[0])) best = f;
  if (Math.abs(frac - best[0]) > 0.04) {
    return String(Math.round(q * 100) / 100);
  }
  const w = best[0] === 1 ? whole + 1 : whole;
  if (!best[1]) return String(w);
  return w ? `${w}${best[1]}` : best[1];
}

/** Return the ingredient line scaled by factor, rebuilding text when we understood it. */
export function scaleIngredient(ing: Ingredient, factor: number): string {
  if (factor === 1 || ing.quantity === null) return ing.text;
  let q = formatQuantity(ing.quantity * factor);
  if (ing.quantityMax) q += `–${formatQuantity(ing.quantityMax * factor)}`;
  const parts = [q, ing.unit, ing.name].filter(Boolean).join(' ');
  return ing.note ? `${parts}, ${ing.note}` : parts;
}

/** Normalize a name for combining in shopping lists: "Onions" -> "onion". */
export function normalizeName(name: string): string {
  let n = name.toLowerCase()
    .replace(/\b(large|small|medium|fresh|freshly|chopped|diced|minced|sliced|finely|roughly|ground|whole|ripe|peeled)\b/g, '')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (n.endsWith('ies')) n = n.slice(0, -3) + 'y';
  else if (n.endsWith('oes')) n = n.slice(0, -2);
  else if (n.endsWith('s') && !n.endsWith('ss')) n = n.slice(0, -1);
  return n;
}

/** Convert to a base unit within a family so "1 tbsp" + "1 tsp" can combine. */
const FAMILIES: Record<string, [string, number]> = {
  tsp: ['ml', 4.929], tbsp: ['ml', 14.787], cup: ['ml', 236.6], ml: ['ml', 1], l: ['ml', 1000],
  'fl oz': ['ml', 29.57], pint: ['ml', 473.2], quart: ['ml', 946.4],
  g: ['g', 1], kg: ['g', 1000], oz: ['g', 28.35], lb: ['g', 453.6],
};

export function toBase(q: number, unit: string | null): { q: number; unit: string | null } {
  if (unit && FAMILIES[unit]) return { q: q * FAMILIES[unit][1], unit: FAMILIES[unit][0] };
  return { q, unit };
}

/** Choose a friendly display for a combined base quantity. */
export function fromBase(q: number, unit: string | null, preferred: string | null): { q: number; unit: string | null } {
  if (preferred && FAMILIES[preferred] && unit === FAMILIES[preferred][0]) {
    return { q: q / FAMILIES[preferred][1], unit: preferred };
  }
  return { q, unit };
}
