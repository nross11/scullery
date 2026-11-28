// Convert between the structured recipe body and the simple text format used in the editor.
// Ingredients: one per line. Steps: one per line (blank lines ignored).
// Recipes are one flat list of each, so older group headings are dropped and "#" lines are skipped.

import { parseIngredient } from './ingredients';
import { flatIngredients, flatSteps, type IngredientGroup, type StepGroup } from './recipe';

export function ingredientsToText(groups: IngredientGroup[]): string {
  return flatIngredients(groups)[0].items.map((i) => i.text).join('\n');
}

export function textToIngredients(text: string): IngredientGroup[] {
  const items = text
    .split('\n')
    .map((l) => l.trim().replace(/^[-•*▢]\s+/, ''))
    .filter((l) => l && !l.startsWith('#'))
    .map(parseIngredient);
  return [{ title: null, items }];
}

export function stepsToText(groups: StepGroup[]): string {
  return flatSteps(groups)[0].steps.join('\n');
}

export function textToSteps(text: string): StepGroup[] {
  const steps = text
    .split('\n')
    .filter((raw) => !raw.trim().startsWith('#'))
    .map((raw) => raw.trim().replace(/^(step\s*)?\d+[.):]\s+/i, ''))
    .filter(Boolean);
  return [{ title: null, steps }];
}

/** Line-based diff (LCS) for showing what changed between versions. */
export function lineDiff(a: string, b: string): { type: 'same' | 'add' | 'del'; text: string }[] {
  const A = a.split('\n');
  const B = b.split('\n');
  const n = A.length;
  const m = B.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: { type: 'same' | 'add' | 'del'; text: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { out.push({ type: 'same', text: A[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ type: 'del', text: A[i++] });
    else out.push({ type: 'add', text: B[j++] });
  }
  while (i < n) out.push({ type: 'del', text: A[i++] });
  while (j < m) out.push({ type: 'add', text: B[j++] });
  return out;
}
