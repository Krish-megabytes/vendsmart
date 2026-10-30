const test = require('node:test');
const assert = require('node:assert/strict');
const { digestPickupCode, encryptPickupCode, decryptPickupCode, verifyPickupCode } = require('./pickupCode');

process.env.JWT_SECRET ||= 'vendsmart-local-test-secret-at-least-thirty-two-characters';

test('verifies only the correct fixed-width pickup code', () => {
  const digest = digestPickupCode('004271');
  assert.equal(verifyPickupCode('004271', digest), true);
  assert.equal(verifyPickupCode('004272', digest), false);
  assert.equal(verifyPickupCode('4271', digest), false);
  assert.equal(verifyPickupCode('004271', ''), false);
});

test('encrypts pickup codes at rest and recovers them only with the application key', () => {
  const encrypted = encryptPickupCode('006542');
  assert.notEqual(encrypted, '006542');
  assert.equal(decryptPickupCode(encrypted), '006542');
  assert.equal(decryptPickupCode(''), undefined);
  assert.throws(() => decryptPickupCode('not-a-valid-ciphertext'), /invalid/i);
});

test('requires a configured strong JWT secret for pickup code encryption', () => {
  const original = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'short';
  try { assert.throws(() => digestPickupCode('123456'), /at least 32 characters/); }
  finally { process.env.JWT_SECRET = original; }
});
