const mongoose = require('mongoose');

const complaintSchema = new mongoose.Schema({
  reference: { type: String, required: true, unique: true, index: true },
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  reservation: { type: mongoose.Schema.Types.ObjectId, ref: 'Reservation' },
  machine: { type: mongoose.Schema.Types.ObjectId, ref: 'Machine' },
  category: { type: String, enum: ['ORDER', 'PAYMENT', 'MACHINE', 'OTHER'], required: true },
  subject: { type: String, required: true, trim: true, maxlength: 120 },
  message: { type: String, required: true, trim: true, maxlength: 2000 },
  status: { type: String, enum: ['OPEN', 'RESOLVED'], default: 'OPEN', index: true },
  response: { type: String, maxlength: 1000 },
  resolvedAt: Date,
  resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

complaintSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('Complaint', complaintSchema);
