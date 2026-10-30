const test = require('node:test');
const assert = require('node:assert/strict');
const { parseProductIntent, rankProduct } = require('./recommendations');
process.env.JWT_SECRET ||= 'vendsmart-local-test-secret-at-least-thirty-two-characters';

const catalog = [
  { name: 'Almond Oat Bar', category: 'Snacks', description: 'Oats and honey', price: 2.75, tags: ['vegan', 'protein'] },
  { name: 'Cold Brew Coffee', category: 'Drinks', description: 'Ready to go', price: 4.25, tags: ['coffee', 'caffeine'] },
  { name: 'Protein Crisps', category: 'Better for you', description: 'Chickpea crisps', price: 3.75, tags: ['protein', 'vegan'] },
];

test('parses price ceilings and dietary/category preferences', () => {
  const intent = parseProductIntent('I want a vegan snack under $4');
  assert.deepEqual(intent.categories, ['Snacks']);
  assert.deepEqual(intent.tags, ['vegan']);
  assert.equal(intent.maxPrice, 4);
  assert.ok(rankProduct(catalog[0], intent, 8) > 0);
  assert.equal(rankProduct(catalog[1], intent, 8), -1);
});

test('keeps an unmatched phrase usable as a search ranking signal', () => {
  const intent = parseProductIntent('coffee please');
  assert.ok(rankProduct(catalog[1], intent, 6) > rankProduct(catalog[0], intent, 6));
});

test('filters unmatched free-text instead of returning misleading recommendations', () => {
  const intent = parseProductIntent('something salty');
  assert.equal(rankProduct(catalog[0], intent), -1);
});

test('returns all products in stable rank-neutral order for a blank prompt', () => {
  const intent = parseProductIntent('');
  assert.equal(rankProduct(catalog[0], intent), 0);
  assert.equal(intent.maxPrice, undefined);
});
