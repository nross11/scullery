// Turn a web page's schema.org Recipe data into a RecipeDraft.
// Pure functions: the Worker fetches the HTML and passes it in.

import { parseIngredient } from './ingredients';
import { emptyBody, sourceKindOf, type RecipeDraft, type StepGroup } from './recipe';

type Json = any; // schema.org data is loosely shaped

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&frac12;/g, '½').replace(/&frac14;/g, '¼').replace(/&frac34;/g, '¾')
    .replace(/&deg;/g, '°');
}

export function cleanText(s: unknown): string {
  if (typeof s !== 'string') return '';
  return decodeEntities(decodeEntities(s.replace(/<[^>]+>/g, ' '))).replace(/\s+/g, ' ').trim();
}

/** ISO 8601 duration ("PT1H30M") -> minutes. */
export function parseDuration(d: unknown): number | null {
  if (typeof d !== 'string') return null;
  const m = d.match(/^P(?:(\d+)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+)S)?)?$/i);
  if (!m) return null;
  const mins = (+(m[1] || 0)) * 1440 + (+(m[2] || 0)) * 60 + (+(m[3] || 0)) + Math.round(+(m[4] || 0) / 60);
  return mins || null;
}

function isRecipe(node: Json): boolean {
  const t = node?.['@type'];
  return t === 'Recipe' || (Array.isArray(t) && t.includes('Recipe'));
}

function findRecipe(node: Json): Json | null {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const r = findRecipe(n);
      if (r) return r;
    }
    return null;
  }
  if (isRecipe(node)) return node;
  for (const key of ['@graph', 'mainEntity', 'mainEntityOfPage', 'itemListElement', 'item']) {
    if (node[key]) {
      const r = findRecipe(node[key]);
      if (r) return r;
    }
  }
  return null;
}

export function extractJsonLd(html: string): Json[] {
  const out: Json[] = [];
  const re = /<script[^>]*type=["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const raw = m[1].trim().replace(/^<!\[CDATA\[|\]\]>$/g, '');
    try {
      out.push(JSON.parse(raw));
    } catch {
      // Some sites put stray control characters in; try once more after stripping them.
      try {
        out.push(JSON.parse(raw.replace(/[\u0000-\u001f]+/g, ' ')));
      } catch {
        /* ignore */
      }
    }
  }
  return out;
}

function parseServings(y: Json): { servings: number | null; label: string | null } {
  const vals = (Array.isArray(y) ? y : [y]).map((v) => (typeof v === 'number' ? String(v) : cleanText(v))).filter(Boolean);
  if (!vals.length) return { servings: null, label: null };
  let servings: number | null = null;
  for (const v of vals) {
    const n = v.match(/\d+/);
    if (n) {
      servings = parseInt(n[0], 10);
      break;
    }
  }
  const label = vals.find((v) => /[a-z]/i.test(v) && !/^\d+\s*(servings?|serves|people|portions?)?$/i.test(v)) ?? null;
  return { servings, label };
}

function parseInstructions(ins: Json): StepGroup[] {
  if (!ins) return [];
  if (typeof ins === 'string') {
    const text = decodeEntities(ins);
    const parts = text
      .split(/\n+|<\/?(?:p|li|br)[^>]*>/i)
      .map(cleanText)
      .filter(Boolean);
    return [{ title: null, steps: parts.length > 1 ? parts : splitSentencesIfLong(cleanText(text)) }];
  }
  const list = Array.isArray(ins) ? ins : [ins];
  const groups: StepGroup[] = [];
  let loose: string[] = [];
  const flushLoose = () => {
    if (loose.length) groups.push({ title: null, steps: loose });
    loose = [];
  };
  for (const item of list) {
    if (typeof item === 'string') {
      const t = cleanText(item);
      if (t) loose.push(t);
    } else if (item?.['@type'] === 'HowToSection' || item?.itemListElement) {
      flushLoose();
      const steps: string[] = [];
      for (const s of [].concat(item.itemListElement ?? [])) {
        const t = cleanText(typeof s === 'string' ? s : (s as Json).text ?? (s as Json).name);
        if (t) steps.push(t);
      }
      groups.push({ title: cleanText(item.name) || null, steps });
    } else {
      const t = cleanText(item?.text ?? item?.name);
      if (t) loose.push(t);
    }
  }
  flushLoose();
  return groups;
}

function splitSentencesIfLong(text: string): string[] {
  if (!text) return [];
  if (text.length < 400) return [text];
  return text.split(/(?<=\.)\s+(?=[A-Z])/).filter(Boolean);
}

function pickImage(img: Json): string | null {
  if (!img) return null;
  if (typeof img === 'string') return img;
  if (Array.isArray(img)) return pickImage(img[img.length > 1 ? img.length - 1 : 0]) ?? pickImage(img[0]);
  return img.url ?? img.contentUrl ?? null;
}

function pickAuthor(a: Json): string | null {
  if (!a) return null;
  if (typeof a === 'string') return cleanText(a);
  if (Array.isArray(a)) return pickAuthor(a[0]);
  return cleanText(a.name) || null;
}

function keywordsToTags(r: Json): string[] {
  const tags = new Set<string>();
  const add = (v: Json) => {
    for (const s of (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : [])) {
      const t = cleanText(s).toLowerCase();
      if (t && t.length <= 30) tags.add(t);
    }
  };
  add(r.recipeCategory);
  add(r.recipeCuisine);
  return [...tags].slice(0, 8);
}

/** Build a draft from a schema.org Recipe object. */
export function draftFromSchema(r: Json, url: string): RecipeDraft {
  const body = emptyBody();
  body.description = cleanText(r.description) || null;
  const { servings, label } = parseServings(r.recipeYield);
  body.servings = servings;
  body.servingsLabel = label;
  body.prepMinutes = parseDuration(r.prepTime);
  body.cookMinutes = parseDuration(r.cookTime);
  body.totalMinutes = parseDuration(r.totalTime);
  body.author = pickAuthor(r.author);
  const ings: string[] = [].concat(r.recipeIngredient ?? r.ingredients ?? []).map(cleanText).filter(Boolean);
  body.ingredients = [{ title: null, items: ings.map(parseIngredient) }];
  const steps = parseInstructions(r.recipeInstructions);
  if (steps.length) body.steps = steps;
  return {
    title: cleanText(r.name) || 'Untitled recipe',
    body,
    sourceUrl: url,
    sourceKind: sourceKindOf(url),
    imageUrl: pickImage(r.image),
    tags: keywordsToTags(r),
  };
}

function metaContent(html: string, prop: string): string | null {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${prop}["']`,
    'i',
  );
  const m = html.match(re);
  return m ? cleanText(m[1] ?? m[2]) : null;
}

export type ImportResult =
  | { ok: true; draft: RecipeDraft; structured: boolean };

/**
 * Import from HTML. If there's a schema.org Recipe we use it; otherwise we fall back
 * to page title/description/image so the user can tidy by hand.
 */
export function importFromHtml(html: string, url: string, pastedText?: string | null): ImportResult {
  const kind = sourceKindOf(url);
  if (kind === 'web') {
    for (const block of extractJsonLd(html)) {
      const r = findRecipe(block);
      if (r) return { ok: true, draft: draftFromSchema(r, url), structured: true };
    }
  }
  const body = emptyBody();
  const desc = metaContent(html, 'og:description') ?? metaContent(html, 'description');
  body.description = kind === 'web' ? desc : null;
  body.rawText = [pastedText?.trim(), kind !== 'web' ? desc : null].filter(Boolean).join('\n\n') || null;
  const title = metaContent(html, 'og:title') ?? cleanText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]) ?? '';
  return {
    ok: true,
    structured: false,
    draft: {
      title: title || 'Untitled recipe',
      body,
      sourceUrl: url,
      sourceKind: kind,
      imageUrl: metaContent(html, 'og:image'),
      tags: [],
    },
  };
}

/** Best-effort split of pasted caption text into ingredient and step lines. */
export function roughSplitText(text: string): { ingredients: string[]; steps: string[] } {
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const ingredients: string[] = [];
  const steps: string[] = [];
  let mode: 'none' | 'ing' | 'steps' = 'none';
  for (const line of lines) {
    if (/^(ingredients?)\b[:\s]*$/i.test(line)) { mode = 'ing'; continue; }
    if (/^(method|instructions?|directions?|steps?|how to make( it)?)\b[:\s]*$/i.test(line)) { mode = 'steps'; continue; }
    const looksIng = /^[-•*▢]?\s*(\d|[¼½¾⅓⅔])/.test(line) && line.length < 90;
    const looksStep = /^\d+[.)]\s+/.test(line) && line.length >= 25;
    if (mode === 'steps' || looksStep) steps.push(line.replace(/^\d+[.)]\s+/, ''));
    else if (mode === 'ing' || looksIng) ingredients.push(line.replace(/^[-•*▢]\s*/, ''));
  }
  return { ingredients, steps };
}
