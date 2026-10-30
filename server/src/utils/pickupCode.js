const crypto = require('crypto');

function key() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) throw new Error('JWT_SECRET must contain at least 32 characters.');
  return crypto.createHash('sha256').update(secret).digest();
}

function digestPickupCode(otp) {
  return crypto.createHmac('sha256', key()).update(String(otp)).digest('hex');
}

function encryptPickupCode(otp) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const encrypted = Buffer.concat([cipher.update(String(otp), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(part => part.toString('base64url')).join('.');
}

function decryptPickupCode(value) {
  if (!value) return undefined;
  const [ivText, tagText, encryptedText] = value.split('.');
  if (!ivText || !tagText || !encryptedText) throw new Error('Stored pickup code is invalid.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(ivText, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(encryptedText, 'base64url')), decipher.final()]).toString('utf8');
}

function verifyPickupCode(otp, storedDigest) {
  const expected = Buffer.from(String(storedDigest || ''), 'hex');
  const actual = Buffer.from(digestPickupCode(otp), 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(actual, expected);
}

module.exports = { digestPickupCode, encryptPickupCode, decryptPickupCode, verifyPickupCode };
