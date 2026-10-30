const express = require('express');
const router = express.Router();
const { listUsers, setUserBan, deleteUser } = require('../controllers/adminController');
const { protect, authorize } = require('../middleware/auth');

router.use(protect, authorize('ADMIN'));

router.get('/', listUsers);
router.patch('/:id/ban', setUserBan);
router.delete('/:id', deleteUser);

module.exports = router;
