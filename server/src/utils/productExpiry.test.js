const test = require('node:test');
const assert = require('node:assert/strict');
const Inventory = require('../models/Inventory');
const {
  parseExpirationDate,
  isExpired,
  isNearExpiry,
  availableQuantity,
  discountedPrice,
  dateOnly,
} = require('./productExpiry');

const now = new Date('2026-10-31T12:00:00.000Z');

test('parses valid calendar dates as expiring at the end of that UTC day', () => {
  const expiry = parseExpirationDate('2026-10-31');
  assert.equal(expiry.toISOString(), '2026-10-31T23:59:59.999Z');
  assert.equal(dateOnly(expiry), '2026-10-31');
  assert.equal(parseExpirationDate('2026-02-30'), undefined);
  assert.equal(parseExpirationDate('31-10-2026'), undefined);
});

test('blocks stock after expiry while preserving undated legacy stock', () => {
  const expired = parseExpirationDate('2026-10-30');
  assert.equal(isExpired(expired, now), true);
  assert.equal(availableQuantity({ quantity: 8, reserved: 2, expirationDate: expired }, now), 0);
  assert.equal(availableQuantity({ quantity: 8, reserved: 2, expirationDate: null }, now), 6);
});

test('inventory model exposes expired stock as unavailable', () => {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const row = new Inventory({
    quantity: 8,
    reserved: 2,
    expirationDate: parseExpirationDate(yesterday),
  });
  assert.equal(row.available, 0);
});

test('allows discounts only in the seven-day expiry window and calculates prices safely', () => {
  const near = parseExpirationDate('2026-11-07');
  const later = parseExpirationDate('2026-11-08');
  assert.equal(isNearExpiry(near, now), true);
  assert.equal(isNearExpiry(later, now), false);
  assert.deepEqual(discountedPrice({ price: 10 }, { expirationDate: near, discountPercent: 25 }, now), {
    price: 7.5,
    originalPrice: 10,
    discountPercent: 25,
  });
  assert.deepEqual(discountedPrice({ price: 10 }, { expirationDate: later, discountPercent: 25 }, now), { price: 10 });
  assert.deepEqual(discountedPrice({ price: 10 }, { expirationDate: parseExpirationDate('2026-10-30'), discountPercent: 25 }, now), { price: 10 });
});
