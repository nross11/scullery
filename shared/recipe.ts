// The standardized recipe format used everywhere in Scullery.

export interface Ingredient {
  /** Original text as written, e.g. "2 1/2 cups plain flour, sifted" */
  text: string;
  quantity: number | null;
  /** Upper bound for ranges like "2-3" */
  quantityMax?: number | null;
  unit: string | null;
  name: string;
  note?: string | null;
}

export interface IngredientGroup {
  title: string | null; // e.g. "For the sauce"
  items: Ingredient[];
}

export interface StepGroup {
  title: string | null;
  steps: string[];
}

export interface RecipeBody {
  description: string | null;
  servings: number | null;
  servingsLabel: string | null; // e.g. "12 cookies"
  prepMinutes: number | null;
  cookMinutes: number | null;
  totalMinutes: number | null;
  ingredients: IngredientGroup[];
  steps: StepGroup[];
  notes: string | null;
  /** Raw caption/description pasted from a social post, kept for manual tidy-up */
  rawText?: string | null;
  author?: string | null;
}

export interface RecipeDraft {
  title: string;
  body: RecipeBody;
  sourceUrl: string | null;
  sourceKind: SourceKind;
  imageUrl: string | null;
  tags: string[];
}

export type SourceKind = 'web' | 'youtube' | 'instagram' | 'tiktok' | 'manual';

export function emptyBody(): RecipeBody {
  return {
    description: null,
    servings: null,
    servingsLabel: null,
    prepMinutes: null,
    cookMinutes: null,
    totalMinutes: null,
    ingredients: [{ title: null, items: [] }],
    steps: [{ title: null, steps: [] }],
    notes: null,
  };
}

export function sourceKindOf(url: string | null | undefined): SourceKind {
  if (!url) return 'manual';
  let host = '';
  try {
    host = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'manual';
  }
  if (host === 'youtu.be' || host.endsWith('youtube.com')) return 'youtube';
  if (host.endsWith('instagram.com')) return 'instagram';
  if (host.endsWith('tiktok.com')) return 'tiktok';
  return 'web';
}
