const test = require('node:test');
const assert = require('node:assert/strict');
const { projectStock } = require('./forecast');
process.env.JWT_SECRET ||= 'vendsmart-local-test-secret-at-least-thirty-two-characters';

test('projects days remaining and replenishment for a steady selling product', () => {
  assert.deepEqual(projectStock({ available: 14, reserved: 2, lowStockThreshold: 4, unitsSold: 60, days: 30 }), {
    available: 14,
    reserved: 2,
    dailyAverage: 2,
    daysRemaining: 7,
    suggestedRestock: 0,
  });
});

test('recommends the larger of minimum safety stock and one week of demand', () => {
  assert.deepEqual(projectStock({ available: 2, lowStockThreshold: 5, unitsSold: 90, days: 30 }), {
    available: 2,
    reserved: 0,
    dailyAverage: 3,
    daysRemaining: 0.7,
    suggestedRestock: 19,
  });
});

test('does not invent a demand forecast when there is no sales history', () => {
  assert.deepEqual(projectStock({ available: 8, lowStockThreshold: 5, unitsSold: 0, days: 30 }), {
    available: 8,
    reserved: 0,
    dailyAverage: 0,
    daysRemaining: null,
    suggestedRestock: 2,
  });
});

test('clamps invalid quantities and zero-length periods safely', () => {
  assert.deepEqual(projectStock({ available: -2, reserved: -1, lowStockThreshold: 0, unitsSold: 5, days: 0 }), {
    available: 0,
    reserved: 0,
    dailyAverage: 5,
    daysRemaining: 0,
    suggestedRestock: 35,
  });
});
