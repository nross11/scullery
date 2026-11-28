import { describe, expect, it } from 'vitest';
import { bodyFromAi, htmlToText, recipeAsText, youtubeDescription, type AiRecipeFields } from '../shared/aiRecipe';

const fields: AiRecipeFields = {
  title: 'Creamy tomato pasta',
  description: 'Quick weeknight pasta.',
  servings: 4,
  servingsLabel: null,
  prepMinutes: 10,
  cookMinutes: 20,
  totalMinutes: null,
  ingredients: ['400 g penne', '200 ml double cream', '', 'Salt, to taste'],
  steps: ['1. Boil the pasta.', 'Step 2: Stir in the cream.'],
  notes: null,
};

describe('bodyFromAi', () => {
  it('parses ingredients and strips step numbers', () => {
    const b = bodyFromAi(fields);
    expect(b.ingredients).toHaveLength(1);
    expect(b.ingredients[0].title).toBeNull();
    expect(b.ingredients[0].items).toHaveLength(3);
    expect(b.ingredients[0].items[2].text).toBe('Salt, to taste');
    expect(b.ingredients[0].items[0]).toMatchObject({ quantity: 400, unit: 'g', name: 'penne' });
    expect(b.steps[0].steps).toEqual(['Boil the pasta.', 'Stir in the cream.']);
    expect(b.servings).toBe(4);
    expect(b.totalMinutes).toBeNull();
  });
  it('keeps fields Claude does not return', () => {
    const b = bodyFromAi(fields, { ...bodyFromAi(fields), author: 'Nonna', rawText: 'caption' });
    expect(b.author).toBe('Nonna');
    expect(b.rawText).toBe('caption');
  });
  it('round-trips through the text Claude reads', () => {
    const text = recipeAsText('Creamy tomato pasta', bodyFromAi(fields));
    expect(text).toContain('400 g penne');
    expect(text).toContain('Serves 4');
  });
});

describe('page text', () => {
  it('drops scripts and navigation', () => {
    const t = htmlToText('<html><nav>Home</nav><script>var x=1</script><main><h1>Soup</h1><p>2 cups stock</p></main></html>');
    expect(t).toBe('Soup\n2 cups stock');
  });
  it('reads the full YouTube description', () => {
    const html = '<script>var ytInitialPlayerResponse = {"videoDetails":{"title":"Best Ramen","shortDescription":"Ingredients:\\n2 eggs\\n1 tbsp miso","author":"Chef Kim"}}</script>';
    expect(youtubeDescription(html)).toEqual({ title: 'Best Ramen', description: 'Ingredients:\n2 eggs\n1 tbsp miso', channel: 'Chef Kim' });
  });
});
