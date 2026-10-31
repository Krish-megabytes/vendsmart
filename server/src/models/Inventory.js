const mongoose = require('mongoose');
const { availableQuantity } = require('../utils/productExpiry');

const inventorySchema = new mongoose.Schema({
  machine: { type: mongoose.Schema.Types.ObjectId, ref: 'Machine', required: true, index: true },
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
  quantity: { type: Number, min: 0, default: 0 },
  reserved: { type: Number, min: 0, default: 0 },
  lowStockThreshold: { type: Number, min: 0, default: 5 },
  slot: { type: String, trim: true, default: '' },
  expirationDate: { type: Date, default: null },
  discountPercent: { type: Number, min: 0, max: 90, default: 0 },
}, { timestamps: true });

inventorySchema.index({ machine: 1, product: 1 }, { unique: true });
inventorySchema.virtual('available').get(function () { return availableQuantity(this); });
inventorySchema.set('toJSON', { virtuals: true });
inventorySchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Inventory', inventorySchema);
