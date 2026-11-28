// Pure helpers for the Claude features: the JSON shape we ask Claude for, turning
// pages into plain text for it, and turning its answer back into a RecipeBody.

import { parseIngredient } from './ingredients';
import { cleanText } from './importer';
import { emptyBody, type RecipeBody } from './recipe';
import { ingredientsToText, stepsToText } from './editorText';

const nullable = (type: 'string' | 'integer') => ({ anyOf: [{ type }, { type: 'null' }] });

const recipeProps = {
  title: { type: 'string', description: 'Short, plain recipe name, e.g. "Chicken Tikka Masala". No emoji, hashtags or creator handles.' },
  description: { ...nullable('string'), description: 'One or two sentences about the dish, or null.' },
  servings: { ...nullable('integer'), description: 'Number of servings, or null if unknown.' },
  servingsLabel: { ...nullable('string'), description: 'Only when the yield is not people, e.g. "12 cookies". Otherwise null.' },
  prepMinutes: nullable('integer'),
  cookMinutes: nullable('integer'),
  totalMinutes: nullable('integer'),
  ingredients: {
    type: 'array',
    items: { type: 'string' },
    description:
      'One flat list, one ingredient per line, no section headings. Start each line with its amount exactly as the source gives it, e.g. "2 tbsp olive oil" or "400 g tin chopped tomatoes". If the source gives no amount, write the ingredient as the source does (e.g. "Olive oil" or "Salt, to taste") and never invent a number.',
  },
  steps: {
    type: 'array',
    items: { type: 'string' },
    description: 'One flat list of method steps in cooking order, one clear instruction per step, no step numbers and no section headings.',
  },
  notes: { ...nullable('string'), description: 'Useful tips, storage or variations from the source, or null.' },
} as const;

const recipeRequired = ['title', 'description', 'servings', 'servingsLabel', 'prepMinutes', 'cookMinutes', 'totalMinutes', 'ingredients', 'steps', 'notes'];

export const IMPORT_SCHEMA = {
  type: 'object',
  properties: {
    found: { type: 'boolean', description: 'false if the material does not contain enough to make a recipe.' },
    problem: { ...nullable('string'), description: 'When found is false, a short plain sentence saying what is missing. Otherwise null.' },
    ...recipeProps,
    author: { ...nullable('string'), description: 'Creator or site author if stated, or null.' },
    tags: { type: 'array', items: { type: 'string' }, description: 'Up to 5 short lowercase tags such as "dinner", "vegetarian", "italian", "quick".' },
    guessed: { type: 'array', items: { type: 'string' }, description: 'Plain-language list of anything you had to estimate (e.g. "Quantities for the sauce were estimated from the video description"). Empty if nothing was guessed.' },
  },
  required: ['found', 'problem', ...recipeRequired, 'author', 'tags', 'guessed'],
  additionalProperties: false,
} as const;

export const HEALTHIER_SCHEMA = {
  type: 'object',
  properties: {
    changes: {
      type: 'array',
      description: 'Each change you made, most impactful first.',
      items: {
        type: 'object',
        properties: {
          change: { type: 'string', description: 'What changed, e.g. "Swap 200 ml double cream for 200 g Greek yogurt".' },
          why: { type: 'string', description: 'One short sentence on the benefit and any effect on taste or texture.' },
        },
        required: ['change', 'why'],
        additionalProperties: false,
      },
    },
    summary: { type: 'string', description: 'A short change note for version history, under 80 characters, e.g. "Healthier: yogurt for cream, less butter".' },
    ...recipeProps,
  },
  required: ['changes', 'summary', ...recipeRequired],
  additionalProperties: false,
} as const;

export interface AiRecipeFields {
  title: string;
  description: string | null;
  servings: number | null;
  servingsLabel: string | null;
  prepMinutes: number | null;
  cookMinutes: number | null;
  totalMinutes: number | null;
  ingredients: string[];
  steps: string[];
  notes: string | null;
}

export interface AiImport extends AiRecipeFields {
  found: boolean;
  problem: string | null;
  author: string | null;
  tags: string[];
  guessed: string[];
}

export interface AiHealthier extends AiRecipeFields {
  changes: { change: string; why: string }[];
  summary: string;
}

const posInt = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n) : null);
const str = (s: unknown) => (typeof s === 'string' && s.trim() ? s.trim() : null);

/** Turn Claude's recipe fields into Scullery's RecipeBody, keeping fields Claude doesn't touch. */
export function bodyFromAi(a: AiRecipeFields, base?: RecipeBody): RecipeBody {
  const body: RecipeBody = { ...emptyBody(), ...(base ?? {}) };
  body.description = str(a.description);
  body.servings = posInt(a.servings);
  body.servingsLabel = str(a.servingsLabel);
  body.prepMinutes = posInt(a.prepMinutes);
  body.cookMinutes = posInt(a.cookMinutes);
  body.totalMinutes = posInt(a.totalMinutes);
  body.ingredients = [{ title: null, items: (a.ingredients ?? []).map((t) => String(t).trim()).filter(Boolean).map(parseIngredient) }];
  body.steps = [{ title: null, steps: (a.steps ?? []).map((s) => String(s).replace(/^\s*(step\s*)?\d+[.):]\s*/i, '').trim()).filter(Boolean) }];
  body.notes = str(a.notes);
  return body;
}

/** Readable text from a web page, for when it has no schema.org recipe. */
export function htmlToText(html: string, maxChars = 60_000): string {
  const main = html.match(/<(article|main)\b[\s\S]*?<\/\1>/i)?.[0] ?? html;
  const text = main
    .replace(/<(script|style|noscript|svg|nav|footer|header|form|iframe)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/?(p|div|li|h[1-6]|br|tr|section|ul|ol)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  const lines = text.split('\n').map((l) => cleanText(l)).filter(Boolean);
  return lines.join('\n').slice(0, maxChars);
}

/** The full video description from a YouTube watch page (the og:description is truncated). */
export function youtubeDescription(html: string): { title: string | null; description: string | null; channel: string | null } {
  const grab = (key: string) => {
    const m = html.match(new RegExp(`"${key}":"((?:[^"\\\\]|\\\\.)*)"`));
    if (!m) return null;
    try {
      return JSON.parse(`"${m[1]}"`) as string;
    } catch {
      return null;
    }
  };
  return { title: grab('title'), description: grab('shortDescription'), channel: grab('ownerChannelName') ?? grab('author') };
}

/** The recipe as plain text, for Claude to read. */
export function recipeAsText(title: string, b: RecipeBody): string {
  const lines = [`# ${title}`];
  if (b.description) lines.push(b.description);
  const facts = [
    b.servings && `Serves ${b.servings}${b.servingsLabel ? ` (${b.servingsLabel})` : ''}`,
    b.prepMinutes && `Prep ${b.prepMinutes} min`,
    b.cookMinutes && `Cook ${b.cookMinutes} min`,
    b.totalMinutes && `Total ${b.totalMinutes} min`,
  ].filter(Boolean);
  if (facts.length) lines.push(facts.join(' · '));
  lines.push('', '## Ingredients', ingredientsToText(b.ingredients), '', '## Method', stepsToText(b.steps));
  if (b.notes) lines.push('', '## Notes', b.notes);
  return lines.join('\n');
}
