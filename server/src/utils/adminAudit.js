const AdminAuditLog = require('../models/AdminAuditLog');

async function recordAdminAudit(req, { action, targetType, targetId, targetLabel, changes = {} }) {
  if (req.user?.role !== 'ADMIN') return;
  await AdminAuditLog.create({
    actor: req.user._id,
    actorName: req.user.name,
    actorEmail: req.user.email,
    action,
    targetType,
    targetId: String(targetId || ''),
    targetLabel: String(targetLabel || targetId || targetType).slice(0, 160),
    changes,
  });
}

module.exports = { recordAdminAudit };
