// Convert between the structured recipe body and the simple text format used in the editor.
// Ingredients: one per line. Steps: one per line (blank lines ignored).
// A line starting with "#" starts a new group, e.g. "# For the sauce".

import { parseIngredient } from './ingredients';
import type { IngredientGroup, StepGroup } from './recipe';

export function ingredientsToText(groups: IngredientGroup[]): string {
  return groups
    .map((g) => [g.title ? `# ${g.title}` : null, ...g.items.map((i) => i.text)].filter((l) => l !== null).join('\n'))
    .filter(Boolean)
    .join('\n\n');
}

export function textToIngredients(text: string): IngredientGroup[] {
  const groups: IngredientGroup[] = [{ title: null, items: [] }];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) {
      const title = line.replace(/^#+\s*/, '').trim();
      if (groups.length === 1 && !groups[0].items.length && !groups[0].title) groups[0].title = title;
      else groups.push({ title, items: [] });
      continue;
    }
    groups[groups.length - 1].items.push(parseIngredient(line));
  }
  return groups;
}

export function stepsToText(groups: StepGroup[]): string {
  return groups
    .map((g) => [g.title ? `# ${g.title}` : null, ...g.steps].filter((l) => l !== null).join('\n'))
    .filter(Boolean)
    .join('\n\n');
}

export function textToSteps(text: string): StepGroup[] {
  const groups: StepGroup[] = [{ title: null, steps: [] }];
  for (const raw of text.split('\n')) {
    const line = raw.trim().replace(/^(step\s*)?\d+[.):]\s+/i, '');
    if (!line) continue;
    if (raw.trim().startsWith('#')) {
      const title = raw.trim().replace(/^#+\s*/, '');
      if (groups.length === 1 && !groups[0].steps.length && !groups[0].title) groups[0].title = title;
      else groups.push({ title, steps: [] });
      continue;
    }
    groups[groups.length - 1].steps.push(line);
  }
  return groups;
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
