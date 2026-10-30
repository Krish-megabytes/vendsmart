const buckets = new Map();
let requestsSinceCleanup = 0;
const MAX_TRACKED_IPS = 10000;

function rateLimit({ windowMs = 15 * 60 * 1000, max = 100, message = 'Too many requests. Please try again later.' } = {}) {
  return (req, res, next) => {
    const key = req.ip || req.socket?.remoteAddress || 'unknown';
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      if (buckets.size >= MAX_TRACKED_IPS) {
        const oldest = buckets.keys().next().value;
        if (oldest !== undefined) buckets.delete(oldest);
      }
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    requestsSinceCleanup += 1;
    if (requestsSinceCleanup >= 1000) {
      requestsSinceCleanup = 0;
      for (const [candidate, value] of buckets) if (value.resetAt <= now) buckets.delete(candidate);
    }
    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, max - bucket.count)));
    res.setHeader('RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));
    if (bucket.count > max) return res.status(429).json({ success: false, error: { code: 'RATE_LIMITED', message } });
    return next();
  };
}

module.exports = { rateLimit };
