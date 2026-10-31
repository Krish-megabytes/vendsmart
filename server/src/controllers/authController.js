const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Generate JWT
const generateToken = (id) => {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) throw new Error('JWT_SECRET must contain at least 32 characters.');
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
};

// @desc    Register a new user
// @route   POST /api/session/register
// @access  Public
exports.register = async (req, res, next) => {
  try {
    const { name, email, phone, password } = req.body;
    const emailParts = typeof email === 'string' && !email.split('').some(character => character.trim() === '') ? email.split('@') : [];
    const validEmail = emailParts.length === 2 && emailParts[0].length > 0 && emailParts[0].length <= 64 && emailParts[1].length > 3 && emailParts[1].length <= 189 && emailParts[1].includes('.') && !emailParts[1].startsWith('.') && !emailParts[1].endsWith('.');
    if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 100 || typeof email !== 'string' || email.length > 254 || !validEmail || typeof password !== 'string' || password.length < 8 || password.length > 128) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Enter a valid name, email, and a password between 8 and 128 characters.' } });
    }

    // Check if user exists
    const normalizedEmail = email.trim().toLowerCase();
    const userExists = await User.findOne({ email: normalizedEmail });
    if (userExists) {
      return res.status(400).json({ success: false, error: { code: 'USER_EXISTS', message: 'User already exists' } });
    }

    const user = await User.create({
      name,
      email: normalizedEmail,
      phone: typeof phone === 'string' ? phone.trim().slice(0, 30) : undefined,
      password,
      role: 'CUSTOMER'
    });

    if (user) {
      res.status(201).json({
        success: true,
        data: {
          _id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          operatorRequestStatus: user.operatorRequestStatus,
          token: generateToken(user._id)
        }
      });
    }
  } catch (error) {
    next(error);
  }
};

// @desc    Auth user & get token
// @route   POST /api/session/login
// @access  Public
exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (typeof email !== 'string' || typeof password !== 'string' || email.length > 254 || password.length > 128) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Enter a valid email and password.' } });

    // Check for user email
    const user = await User.findOne({ email: email.trim().toLowerCase() });

    if (user && (await user.matchPassword(password))) {
      if (user.banned) return res.status(403).json({ success: false, error: { code: 'ACCOUNT_BANNED', message: 'This account has been suspended by an administrator.' } });
      res.json({
        success: true,
        data: {
          _id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          operatorRequestStatus: user.operatorRequestStatus,
          token: generateToken(user._id)
        }
      });
    } else {
      res.status(401).json({ success: false, error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } });
    }
  } catch (error) {
    next(error);
  }
};

// @desc    Get user profile
// @route   GET /api/session/me
// @access  Private
exports.getMe = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).select('-passwordHash');
    res.json({ success: true, data: user });
  } catch (error) {
    next(error);
  }
};

exports.requestOperatorAccess = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Account not found.' } });
    if (user.role !== 'CUSTOMER') return res.status(409).json({ success: false, error: { code: 'ROLE_NOT_ELIGIBLE', message: 'Only customer accounts can request operator access.' } });
    if (user.operatorRequestStatus === 'PENDING') return res.status(409).json({ success: false, error: { code: 'REQUEST_PENDING', message: 'Your operator access request is already awaiting review.' } });
    user.operatorRequestStatus = 'PENDING';
    user.operatorRequestedAt = new Date();
    user.operatorReviewedAt = undefined;
    user.operatorReviewedBy = undefined;
    await user.save();
    return res.status(201).json({ success: true, data: { operatorRequestStatus: user.operatorRequestStatus, operatorRequestedAt: user.operatorRequestedAt } });
  } catch (error) {
    return next(error);
  }
};

// @desc    Logout user / clear cookie (if implementing HTTP-only cookies)
// @route   POST /api/session/logout
// @access  Private
exports.logout = async (req, res, next) => {
  res.json({ success: true, message: 'Logged out successfully' });
};
