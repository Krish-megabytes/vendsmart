const express = require('express');
const router = express.Router();
const { register, login, getMe, logout, requestOperatorAccess } = require('../controllers/authController');
const { protect } = require('../middleware/auth');

router.post('/register', register);
router.post('/login', login);
router.post('/logout', protect, logout);
router.get('/me', protect, getMe);
router.post('/operator-request', protect, requestOperatorAccess);

module.exports = router;
