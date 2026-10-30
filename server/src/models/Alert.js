const mongoose = require('mongoose');

const alertSchema = new mongoose.Schema({
  type: { type: String, enum: ['LOW_STOCK', 'OUT_OF_STOCK', 'MACHINE_OFFLINE', 'MACHINE_MAINTENANCE'], required: true },
  severity: { type: String, enum: ['INFO', 'WARNING', 'CRITICAL'], default: 'WARNING' },
  message: { type: String, required: true },
  machine: { type: mongoose.Schema.Types.ObjectId, ref: 'Machine' },
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  inventory: { type: mongoose.Schema.Types.ObjectId, ref: 'Inventory' },
  resolvedAt: { type: Date, default: null },
  suppressed: { type: Boolean, default: false },
}, { timestamps: true });

alertSchema.index({ resolvedAt: 1, createdAt: -1 });
alertSchema.index({ type: 1, inventory: 1, resolvedAt: 1 }, { unique: true, partialFilterExpression: { resolvedAt: null, inventory: { $type: 'objectId' } } });
alertSchema.index({ type: 1, machine: 1, resolvedAt: 1 }, { unique: true, partialFilterExpression: { resolvedAt: null, inventory: { $exists: false }, machine: { $type: 'objectId' } } });

module.exports = mongoose.model('Alert', alertSchema);
