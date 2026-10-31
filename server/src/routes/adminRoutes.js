const express = require('express');
const router = express.Router();
const { listUsers, listAuditLog, setUserBan, setUserRole, reviewOperatorRequest, deleteUser } = require('../controllers/adminController');
const { protect, authorize } = require('../middleware/auth');

router.use(protect, authorize('ADMIN'));

router.get('/', listUsers);
router.get('/audit-log', listAuditLog);
router.patch('/:id/ban', setUserBan);
router.patch('/:id/role', setUserRole);
router.patch('/:id/operator-request', reviewOperatorRequest);
router.delete('/:id', deleteUser);

module.exports = router;
