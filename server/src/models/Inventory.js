const mongoose = require('mongoose');

const inventorySchema = new mongoose.Schema({
  machine: { type: mongoose.Schema.Types.ObjectId, ref: 'Machine', required: true, index: true },
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
  quantity: { type: Number, min: 0, default: 0 },
  reserved: { type: Number, min: 0, default: 0 },
  lowStockThreshold: { type: Number, min: 0, default: 5 },
  slot: { type: String, trim: true, default: '' },
}, { timestamps: true });

inventorySchema.index({ machine: 1, product: 1 }, { unique: true });
inventorySchema.virtual('available').get(function () { return Math.max(0, this.quantity - this.reserved); });
inventorySchema.set('toJSON', { virtuals: true });
inventorySchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Inventory', inventorySchema);
