const mongoose = require('mongoose');

const reservationSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, index: true },
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  machine: { type: mongoose.Schema.Types.ObjectId, ref: 'Machine', required: true },
  items: [{
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    name: { type: String, required: true },
    sku: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
  }],
  total: { type: Number, required: true, min: 0 },
  status: { type: String, enum: ['PENDING', 'PAID', 'DISPENSED', 'CANCELLED', 'EXPIRED'], default: 'PENDING', index: true },
  paymentMethod: { type: String, enum: ['DEMO', 'CARD', 'UPI', 'CASHLESS'], default: 'DEMO' },
  paymentLast4: { type: String, maxlength: 4 },
  paymentReference: { type: String, maxlength: 40 },
  paidAt: Date,
  otpHash: { type: String, select: false },
  pickupOtp: { type: String, select: false },
  otpExpiresAt: Date,
  dispensedAt: Date,
  cancelledAt: Date,
  refundedAt: Date,
  refundAmount: { type: Number, min: 0 },
}, { timestamps: true });

reservationSchema.index({ createdAt: 1 });
reservationSchema.index({ status: 1, otpExpiresAt: 1 });

module.exports = mongoose.model('Reservation', reservationSchema);
