import { describe, expect, it } from 'vitest';
import { parseIngredient, scaleIngredient, formatQuantity } from '../shared/ingredients';
import { importFromHtml, parseDuration, roughSplitText } from '../shared/importer';
import { buildShoppingList, guessAisle } from '../shared/shopping';

describe('parseIngredient', () => {
  it('handles mixed fractions and units', () => {
    const i = parseIngredient('2 1/2 cups plain flour, sifted');
    expect(i).toMatchObject({ quantity: 2.5, unit: 'cup', name: 'plain flour', note: 'sifted' });
  });
  it('handles unicode fractions, ranges and notes', () => {
    expect(parseIngredient('½ tsp salt')).toMatchObject({ quantity: 0.5, unit: 'tsp', name: 'salt' });
    expect(parseIngredient('2-3 cloves garlic (minced)')).toMatchObject({ quantity: 2, quantityMax: 3, unit: 'clove', name: 'garlic', note: 'minced' });
    expect(parseIngredient('200g butter')).toMatchObject({ quantity: 200, unit: 'g', name: 'butter' });
  });
  it('leaves unquantified lines alone', () => {
    expect(parseIngredient('Salt and pepper to taste')).toMatchObject({ quantity: null, unit: null });
  });
});

describe('scaling', () => {
  it('scales with nice fractions', () => {
    expect(scaleIngredient(parseIngredient('1 cup milk'), 1.5)).toBe('1½ cups milk');
    expect(scaleIngredient(parseIngredient('500ml stock'), 2)).toBe('1 l stock');
    expect(scaleIngredient(parseIngredient('3 eggs'), 1 / 3)).toBe('1 eggs');
    expect(formatQuantity(0.333)).toBe('⅓');
  });
});

describe('importer', () => {
  const html = `<html><head><script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebPage"},{"@type":["Recipe"],"name":"Best Pancakes &amp; Syrup","recipeYield":["4","4 pancakes"],"prepTime":"PT10M","cookTime":"PT1H5M","recipeIngredient":["1 cup flour","2 eggs"],"recipeInstructions":[{"@type":"HowToSection","name":"Batter","itemListElement":[{"@type":"HowToStep","text":"Mix."}]},{"@type":"HowToStep","text":"Fry."}],"image":{"url":"https://x/img.jpg"},"recipeCategory":"Breakfast"}]}</script></head></html>`;
  it('extracts schema.org recipes from @graph', () => {
    const r = importFromHtml(html, 'https://example.com/pancakes');
    expect(r.structured).toBe(true);
    expect(r.draft.title).toBe('Best Pancakes & Syrup');
    expect(r.draft.body.servings).toBe(4);
    expect(r.draft.body.cookMinutes).toBe(65);
    expect(r.draft.body.steps).toEqual([{ title: 'Batter', steps: ['Mix.'] }, { title: null, steps: ['Fry.'] }]);
    expect(r.draft.imageUrl).toBe('https://x/img.jpg');
    expect(r.draft.tags).toEqual(['breakfast']);
  });
  it('falls back to og tags and keeps pasted caption for social', () => {
    const r = importFromHtml('<meta property="og:title" content="Pasta reel"><meta property="og:description" content="caption here">', 'https://www.instagram.com/reel/abc', 'my notes');
    expect(r.structured).toBe(false);
    expect(r.draft.sourceKind).toBe('instagram');
    expect(r.draft.body.rawText).toBe('my notes\n\ncaption here');
  });
  it('parses durations', () => {
    expect(parseDuration('PT1H30M')).toBe(90);
    expect(parseDuration('P0DT0H20M')).toBe(20);
  });
  it('roughly splits captions', () => {
    const s = roughSplitText('Ingredients:\n2 cups rice\n1 onion\nMethod:\nCook the rice until fluffy.\nAdd onion.');
    expect(s.ingredients).toEqual(['2 cups rice', '1 onion']);
    expect(s.steps).toHaveLength(2);
  });
});

describe('shopping list', () => {
  it('combines same items across units in a family', () => {
    const lines = buildShoppingList([
      { ingredient: parseIngredient('1 onion, diced'), factor: 1, recipeTitle: 'A' },
      { ingredient: parseIngredient('2 onions'), factor: 1, recipeTitle: 'B' },
      { ingredient: parseIngredient('1 tbsp olive oil'), factor: 2, recipeTitle: 'A' },
      { ingredient: parseIngredient('1 tbsp olive oil'), factor: 1, recipeTitle: 'B' },
    ]);
    const onion = lines.find((l) => l.name.startsWith('onion'))!;
    expect(onion.quantity).toBe(3);
    expect(onion.aisle).toBe('Produce');
    expect(onion.sources).toEqual(['A', 'B']);
    expect(lines.find((l) => l.name === 'olive oil')).toMatchObject({ quantity: 3, unit: 'tbsp', aisle: 'Pantry' });
  });
  it('knows black pepper is pantry', () => {
    expect(guessAisle('black pepper')).toBe('Pantry');
    expect(guessAisle('red bell pepper')).toBe('Produce');
  });
});

describe('fixes', () => {
  it('puts stock in pantry and titles social posts', () => {
    expect(guessAisle('vegetable stock')).toBe('Pantry');
    expect(importFromHtml('', 'https://www.tiktok.com/@x/video/1').draft.title).toBe('Recipe from Tiktok');
    expect(importFromHtml('', 'https://www.tiktok.com/@x/video/1', 'Crispy gnocchi\n1 bag gnocchi').draft.title).toBe('Crispy gnocchi');
  });
});
