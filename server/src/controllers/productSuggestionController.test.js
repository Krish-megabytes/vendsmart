const test = require('node:test');
const assert = require('node:assert/strict');
const Product = require('../models/Product');
const ProductSuggestion = require('../models/ProductSuggestion');
const controller = require('./productSuggestionController');

const response = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

test('customers submit a suggestion with normalized names and an initial vote', async () => {
  const originalFindOneAndUpdate = ProductSuggestion.findOneAndUpdate;
  const originalCreate = ProductSuggestion.create;
  let created;
  ProductSuggestion.findOneAndUpdate = async () => null;
  ProductSuggestion.create = async data => {
    created = data;
    return { ...data, _id: '507f1f77bcf86cd799439013', createdAt: new Date(), toObject() { return this; } };
  };
  try {
    const res = response();
    await controller.create({
      user: { _id: '507f1f77bcf86cd799439011', role: 'CUSTOMER' },
      body: { name: '  Sparkling Water ', category: 'Drinks', details: '  Lime flavor  ' },
    }, res, error => { throw error; });
    assert.equal(res.statusCode, 201);
    assert.equal(created.name, 'Sparkling Water');
    assert.equal(created.normalizedName, 'sparkling water');
    assert.deepEqual(created.votes, ['507f1f77bcf86cd799439011']);
    assert.equal(res.body.data.votes, 1);
    assert.equal(res.body.data.voted, true);
  } finally {
    ProductSuggestion.findOneAndUpdate = originalFindOneAndUpdate;
    ProductSuggestion.create = originalCreate;
  }
});

test('a matching open suggestion receives a single vote instead of a duplicate', async () => {
  const originalFindOneAndUpdate = ProductSuggestion.findOneAndUpdate;
  const suggestion = {
    _id: '507f1f77bcf86cd799439013',
    name: 'Sparkling Water',
    category: 'Drinks',
    details: '',
    status: 'OPEN',
    votes: ['507f1f77bcf86cd799439011'],
    createdAt: new Date(),
    toObject() { return this; },
  };
  ProductSuggestion.findOneAndUpdate = async () => {
    if (!suggestion.votes.includes('507f1f77bcf86cd799439011')) suggestion.votes.push('507f1f77bcf86cd799439011');
    return suggestion;
  };
  try {
    const res = response();
    await controller.create({
      user: { _id: '507f1f77bcf86cd799439011', role: 'CUSTOMER' },
      body: { name: 'sparkling water' },
    }, res, error => { throw error; });
    assert.equal(res.statusCode, 200);
    assert.equal(suggestion.votes.length, 1);
    assert.equal(res.body.data.voted, true);
  } finally {
    ProductSuggestion.findOneAndUpdate = originalFindOneAndUpdate;
  }
});

test('operators can only mark a suggestion added when an active product exists', async () => {
  const originalExists = Product.exists;
  const originalUpdate = ProductSuggestion.findOneAndUpdate;
  let update;
  Product.exists = async () => ({ _id: '507f1f77bcf86cd799439014' });
  ProductSuggestion.findOneAndUpdate = () => ({
    populate: async () => ({
      _id: '507f1f77bcf86cd799439013',
      name: 'Sparkling Water',
      category: 'Drinks',
      details: '',
      votes: [],
      status: 'ADDED',
      product: { _id: '507f1f77bcf86cd799439014', name: 'Sparkling Water', sku: 'SPARKLE-1' },
      createdAt: new Date(),
      toObject() { return this; },
    }),
  });
  const findAndUpdate = ProductSuggestion.findOneAndUpdate;
  ProductSuggestion.findOneAndUpdate = (filter, updateDoc, options) => {
    update = { filter, updateDoc, options };
    return findAndUpdate(filter, updateDoc, options);
  };
  try {
    const res = response();
    await controller.review({
      params: { id: '507f1f77bcf86cd799439013' },
      body: { status: 'ADDED', productId: '507f1f77bcf86cd799439014' },
      user: { _id: '507f1f77bcf86cd799439012', role: 'OPERATOR' },
    }, res, error => { throw error; });
    assert.equal(res.statusCode, 200);
    assert.equal(update.updateDoc.$set.status, 'ADDED');
    assert.equal(update.updateDoc.$set.product, '507f1f77bcf86cd799439014');
    assert.equal(res.body.data.product.name, 'Sparkling Water');
  } finally {
    Product.exists = originalExists;
    ProductSuggestion.findOneAndUpdate = originalUpdate;
  }
});

test('non-customers cannot create suggestions', async () => {
  const res = response();
  await controller.create({ user: { role: 'OPERATOR' }, body: { name: 'Water' } }, res, error => { throw error; });
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error.code, 'FORBIDDEN');
});
