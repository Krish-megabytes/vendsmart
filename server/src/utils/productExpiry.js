const DAY_MS = 24 * 60 * 60 * 1000;
const DISCOUNT_WINDOW_DAYS = 7;

function parseExpirationDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
  return date;
}

function isExpired(expirationDate, now = new Date()) {
  return expirationDate instanceof Date && expirationDate.getTime() < now.getTime();
}

function daysUntilExpiry(expirationDate, now = new Date()) {
  if (!(expirationDate instanceof Date)) return null;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const expiryDay = Date.UTC(expirationDate.getUTCFullYear(), expirationDate.getUTCMonth(), expirationDate.getUTCDate());
  return Math.floor((expiryDay - today) / DAY_MS);
}

function isNearExpiry(expirationDate, now = new Date()) {
  const days = daysUntilExpiry(expirationDate, now);
  return days !== null && days >= 0 && days <= DISCOUNT_WINDOW_DAYS && !isExpired(expirationDate, now);
}

function availableQuantity(row, now = new Date()) {
  if (!row || isExpired(row.expirationDate, now)) return 0;
  return Math.max(0, Number(row.quantity || 0) - Number(row.reserved || 0));
}

function discountedPrice(product, row, now = new Date()) {
  const discountPercent = isNearExpiry(row?.expirationDate, now)
    ? Math.max(0, Math.min(90, Number(row?.discountPercent || 0)))
    : 0;
  const originalPrice = Number(product.price);
  return {
    price: discountPercent ? Math.round(originalPrice * (1 - discountPercent / 100) * 100) / 100 : originalPrice,
    ...(discountPercent ? { originalPrice, discountPercent } : {}),
  };
}

function dateOnly(expirationDate) {
  return expirationDate instanceof Date && !Number.isNaN(expirationDate.getTime())
    ? expirationDate.toISOString().slice(0, 10)
    : null;
}

module.exports = {
  DISCOUNT_WINDOW_DAYS,
  parseExpirationDate,
  isExpired,
  isNearExpiry,
  availableQuantity,
  discountedPrice,
  dateOnly,
};
