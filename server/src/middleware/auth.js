const jwt = require('jsonwebtoken');
const User = require('../models/User');

const protect = async (req, res, next) => {
  let token;

  // Check for token in Authorization header
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1];

      // Verify token
      if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) return res.status(503).json({ success: false, error: { code: 'AUTH_NOT_CONFIGURED', message: 'Authentication is not configured securely on this server.' } });
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // Get user from token (exclude passwordHash)
      req.user = await User.findById(decoded.id).select('-passwordHash');

      if (!req.user) {
        return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'User not found' } });
      }

      if (req.user.banned) {
        return res.status(403).json({ success: false, error: { code: 'ACCOUNT_BANNED', message: 'This account has been suspended by an administrator.' } });
      }

      next();
    } catch (error) {
      return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Token failed, not authorized' } });
    }
  }

  if (!token) {
    return res.status(401).json({ success: false, error: { code: 'NO_TOKEN', message: 'Not authorized, no token' } });
  }
};

// Grant access to specific roles
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: `User role ${req.user.role} is not authorized to access this route` }
      });
    }
    next();
  };
};

module.exports = { protect, authorize };
