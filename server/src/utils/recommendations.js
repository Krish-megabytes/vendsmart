const CATEGORY_TERMS = new Map([
  ['snack', 'Snacks'], ['snacks', 'Snacks'], ['drink', 'Drinks'], ['drinks', 'Drinks'], ['beverage', 'Drinks'], ['beverages', 'Drinks'],
  ['healthy', 'Better for you'], ['healthier', 'Better for you'], ['fitness', 'Better for you'], ['protein', 'Better for you'],
  ['essential', 'Essentials'], ['essentials', 'Essentials'],
]);
const TAG_TERMS = new Map([
  ['vegan', 'vegan'], ['plant-based', 'vegan'], ['vegetarian', 'vegetarian'], ['gluten-free', 'gluten-free'], ['gluten free', 'gluten-free'],
  ['protein', 'protein'], ['caffeine', 'caffeine'], ['coffee', 'coffee'], ['chocolate', 'chocolate'], ['sugar-free', 'zero sugar'], ['zero sugar', 'zero sugar'],
]);
const STOP_WORDS = new Set([
  'under', 'below', 'less', 'than', 'with', 'something', 'find', 'that', 'this', 'for', 'the', 'and', 'but', 'want', 'need',
  'looking', 'craving', 'please', 'recommend', 'suggest', 'snack', 'snacks', 'drink', 'drinks', 'beverage', 'beverages', 'healthy',
  'healthier', 'fitness', 'protein', 'essential', 'essentials', 'up', 'to', 'maximum', 'max', 'a', 'an', 'i', 'am', 'im', 'mood',
]);

function parseProductIntent(prompt = '') {
  const query = String(prompt).trim().toLowerCase().slice(0, 180);
  const categories = new Set();
  const tags = new Set();
  for (const [term, category] of CATEGORY_TERMS) if (query.includes(term)) categories.add(category);
  for (const [term, tag] of TAG_TERMS) if (query.includes(term)) tags.add(tag);
  const priceMatch = query.match(/(?:under|below|less than|up to|max(?:imum)?)\s*\$?\s*(\d+(?:\.\d{1,2})?)/);
  const maxPrice = priceMatch ? Number(priceMatch[1]) : undefined;
  const words = [...new Set(query.replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter(word => word.length > 2 && !STOP_WORDS.has(word) && !tags.has(word)))];
  return { query, categories: [...categories], tags: [...tags], maxPrice, words };
}

function rankProduct(product, intent, available) {
  if (intent.maxPrice !== undefined && product.price > intent.maxPrice) return -1;
  if (intent.categories.length && !intent.categories.includes(product.category)) return -1;
  const tags = (product.tags || []).map(value => value.toLowerCase());
  if (intent.tags.some(tag => !tags.includes(tag))) return -1;
  const productTerms = new Set([product.name, product.category, product.description, ...tags].join(' ').toLowerCase().split(/[^a-z0-9-]+/));
  if (!intent.categories.length && !intent.tags.length && intent.words.length && !intent.words.some(word => productTerms.has(word))) return -1;
  let score = 0;
  for (const word of intent.words) if (productTerms.has(word)) score += 2;
  for (const tag of intent.tags) if (tags.includes(tag)) score += 3;
  if (available !== undefined) score += Math.min(1, available / 10);
  if (intent.maxPrice !== undefined) score += Math.max(0, 1 - product.price / Math.max(intent.maxPrice, 0.01));
  return score;
}

module.exports = { parseProductIntent, rankProduct };
