const mongoose = require('mongoose');

const machineSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  code: { type: String, required: true, unique: true, trim: true, uppercase: true },
  description: { type: String, trim: true, maxlength: 500, default: '' },
  address: { type: String, required: true, trim: true },
  location: {
    type: { type: String, enum: ['Point'], default: 'Point', required: true },
    coordinates: { type: [Number], required: true, validate: v => v.length === 2 },
  },
  vendor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  status: { type: String, enum: ['ONLINE', 'OFFLINE', 'MAINTENANCE'], default: 'ONLINE' },
  lastHeartbeat: { type: Date, default: Date.now },
  capacity: { type: Number, min: 1, default: 60 },
}, { timestamps: true });

machineSchema.index({ location: '2dsphere' });

module.exports = mongoose.model('Machine', machineSchema);
