const express = require('express');
const controller = require('../controllers/vendingController');
const suggestions = require('../controllers/productSuggestionController');
const { protect, optionalProtect, authorize } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimit');

const router = express.Router();
const customerWrites = rateLimit({ windowMs: 10 * 60 * 1000, max: 20, message: 'Too many requests from this device. Please wait a few minutes and try again.' });
const operator = [protect, authorize('OPERATOR', 'ADMIN')];
const admin = [protect, authorize('ADMIN')];

router.get('/machines', controller.listMachines);
router.get('/machines/:id', controller.getMachine);
router.post('/machines', ...operator, controller.createMachine);
router.patch('/machines/:id', ...operator, controller.updateMachine);
router.delete('/machines/:id', ...admin, controller.deleteMachine);

router.get('/products', controller.listProducts);
router.get('/recommendations', controller.recommendProducts);
router.post('/products', ...operator, controller.createProduct);
router.patch('/products/:id', ...operator, controller.updateProduct);
router.delete('/products/:id', ...admin, controller.deleteProduct);

router.get('/suggestions', optionalProtect, suggestions.list);
router.post('/suggestions', protect, customerWrites, suggestions.create);
router.post('/suggestions/:id/vote', protect, customerWrites, suggestions.toggleVote);
router.patch('/suggestions/:id/status', ...operator, suggestions.review);

router.get('/favorites', protect, controller.listFavorites);
router.post('/favorites', protect, controller.addFavorite);
router.delete('/favorites/:productId', protect, controller.removeFavorite);

router.get('/inventory', ...operator, controller.listInventory);
router.put('/inventory', ...operator, controller.updateInventory);
router.delete('/inventory/:id', ...operator, controller.deleteInventory);
router.get('/overview', ...operator, controller.overview);
router.get('/forecast', ...operator, controller.forecast);
router.patch('/alerts/:id/resolve', ...operator, controller.resolveAlert);

router.post('/reservations', protect, customerWrites, controller.createReservation);
router.get('/reservations', protect, controller.listReservations);
router.get('/reservations/:id', protect, controller.getReservation);
router.post('/reservations/:id/pay', protect, customerWrites, controller.payReservation);
router.post('/reservations/:id/cancel', protect, controller.cancelReservation);
router.post('/reservations/:id/dispense', protect, controller.dispenseReservation);

router.post('/complaints', protect, customerWrites, controller.createComplaint);
router.get('/complaints', protect, controller.listComplaints);
router.patch('/complaints/:id/resolve', ...operator, controller.resolveComplaint);

module.exports = router;
