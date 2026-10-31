const mongoose = require('mongoose');

const adminAuditLogSchema = new mongoose.Schema({
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  actorName: { type: String, required: true },
  actorEmail: { type: String, required: true },
  action: { type: String, required: true, maxlength: 80 },
  targetType: { type: String, required: true, maxlength: 40 },
  targetId: { type: String, default: '' },
  targetLabel: { type: String, required: true, maxlength: 160 },
  changes: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true, versionKey: false });

adminAuditLogSchema.index({ createdAt: -1, _id: -1 });

module.exports = mongoose.model('AdminAuditLog', adminAuditLogSchema);
