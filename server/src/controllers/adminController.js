const mongoose = require('mongoose');
const User = require('../models/User');
const Machine = require('../models/Machine');
const AdminAuditLog = require('../models/AdminAuditLog');
const { recordAdminAudit } = require('../utils/adminAudit');

const success = (res, data, status = 200) => res.status(status).json({ success: true, data });
const fail = (res, status, code, message) => res.status(status).json({ success: false, error: { code, message } });
const isId = value => mongoose.Types.ObjectId.isValid(value);

// Accounts an administrator can see. Password hashes are never returned.
const publicAccount = (user) => ({
  _id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  banned: Boolean(user.banned),
  bannedAt: user.bannedAt || null,
  operatorRequestStatus: user.operatorRequestStatus || 'NONE',
  operatorRequestedAt: user.operatorRequestedAt || null,
  operatorReviewedAt: user.operatorReviewedAt || null,
  createdAt: user.createdAt,
});

exports.listUsers = async (req, res, next) => {
  try {
    const rows = await User.find().select('-passwordHash -favorites').sort({ role: 1, createdAt: -1 }).limit(500);
    return success(res, rows.map(publicAccount));
  } catch (error) { return next(error); }
};

exports.setUserBan = async (req, res, next) => {
  try {
    if (!isId(req.params.id)) return fail(res, 400, 'INVALID_ID', 'Account id is invalid.');
    if (String(req.params.id) === String(req.user._id)) return fail(res, 400, 'CANNOT_MODIFY_SELF', 'You cannot ban your own account.');
    if (typeof req.body.banned !== 'boolean') return fail(res, 400, 'VALIDATION_ERROR', 'Provide banned as true or false.');
    const target = await User.findById(req.params.id);
    if (!target) return fail(res, 404, 'NOT_FOUND', 'Account not found.');
    if (target.role === 'ADMIN') return fail(res, 403, 'ADMIN_PROTECTED', 'Administrator accounts cannot be banned.');
    const previousBanned = Boolean(target.banned);
    target.banned = req.body.banned;
    target.bannedAt = req.body.banned ? new Date() : undefined;
    await target.save();
    if (previousBanned !== target.banned) await recordAdminAudit(req, {
      action: target.banned ? 'Banned account' : 'Restored account',
      targetType: 'Account',
      targetId: target._id,
      targetLabel: `${target.name} (${target.email})`,
      changes: { banned: { before: previousBanned, after: target.banned } },
    });
    return success(res, publicAccount(target));
  } catch (error) { return next(error); }
};

exports.setUserRole = async (req, res, next) => {
  try {
    if (!isId(req.params.id)) return fail(res, 400, 'INVALID_ID', 'Account id is invalid.');
    if (req.body.role !== 'CUSTOMER') return fail(res, 400, 'VALIDATION_ERROR', 'Operator access must be granted by approving a pending operator request.');
    if (String(req.params.id) === String(req.user._id)) return fail(res, 400, 'CANNOT_MODIFY_SELF', 'You cannot change your own account role.');
    const target = await User.findById(req.params.id);
    if (!target) return fail(res, 404, 'NOT_FOUND', 'Account not found.');
    if (target.role === 'ADMIN') return fail(res, 403, 'ADMIN_PROTECTED', 'Administrator roles cannot be changed.');
    if (target.role === req.body.role) return success(res, publicAccount(target));
    if (target.role === 'OPERATOR' && req.body.role === 'CUSTOMER' && await Machine.exists({ vendor: target._id })) {
      return fail(res, 409, 'OPERATOR_HAS_MACHINES', 'Reassign this operator’s machines before changing them to a customer.');
    }
    const previousRole = target.role;
    target.role = req.body.role;
    await target.save();
    await recordAdminAudit(req, {
      action: 'Changed account role',
      targetType: 'Account',
      targetId: target._id,
      targetLabel: `${target.name} (${target.email})`,
      changes: { role: { before: previousRole, after: target.role } },
    });
    return success(res, publicAccount(target));
  } catch (error) { return next(error); }
};

exports.reviewOperatorRequest = async (req, res, next) => {
  try {
    if (!isId(req.params.id)) return fail(res, 400, 'INVALID_ID', 'Account id is invalid.');
    if (typeof req.body.approved !== 'boolean') return fail(res, 400, 'VALIDATION_ERROR', 'Provide approved as true or false.');
    const target = await User.findById(req.params.id);
    if (!target) return fail(res, 404, 'NOT_FOUND', 'Account not found.');
    if (target.role !== 'CUSTOMER' || target.operatorRequestStatus !== 'PENDING') {
      return fail(res, 409, 'NO_PENDING_REQUEST', 'This account has no pending operator request.');
    }
    if (target.banned) return fail(res, 409, 'ACCOUNT_BANNED', 'Restore this account before reviewing its operator request.');
    const previousRole = target.role;
    target.operatorRequestStatus = req.body.approved ? 'APPROVED' : 'REJECTED';
    target.operatorReviewedAt = new Date();
    target.operatorReviewedBy = req.user._id;
    if (req.body.approved) target.role = 'OPERATOR';
    await target.save();
    await recordAdminAudit(req, {
      action: req.body.approved ? 'Approved operator request' : 'Declined operator request',
      targetType: 'Account',
      targetId: target._id,
      targetLabel: `${target.name} (${target.email})`,
      changes: {
        operatorRequestStatus: { before: 'PENDING', after: target.operatorRequestStatus },
        role: { before: previousRole, after: target.role },
      },
    });
    return success(res, publicAccount(target));
  } catch (error) { return next(error); }
};

exports.deleteUser = async (req, res, next) => {
  try {
    if (!isId(req.params.id)) return fail(res, 400, 'INVALID_ID', 'Account id is invalid.');
    if (String(req.params.id) === String(req.user._id)) return fail(res, 400, 'CANNOT_MODIFY_SELF', 'You cannot remove your own account.');
    const target = await User.findById(req.params.id).select('name email role');
    if (!target) return fail(res, 404, 'NOT_FOUND', 'Account not found.');
    if (target.role === 'ADMIN') return fail(res, 403, 'ADMIN_PROTECTED', 'Administrator accounts cannot be removed.');
    const affectedMachines = target.role === 'OPERATOR'
      ? await Machine.find({ vendor: target._id }, 'name code').lean()
      : [];
    await User.deleteOne({ _id: target._id });
    // Machines survive vendor removal but become unassigned so an admin can hand them to another vendor.
    if (affectedMachines.length) {
      await Machine.updateMany({ vendor: target._id }, { $set: { vendor: null } });
      for (const machine of affectedMachines) await recordAdminAudit(req, {
        action: 'Unassigned machine after operator deletion',
        targetType: 'Machine',
        targetId: machine._id,
        targetLabel: `${machine.name} (${machine.code})`,
        changes: { vendor: { before: String(target._id), after: null } },
      });
    }
    await recordAdminAudit(req, {
      action: 'Deleted account',
      targetType: 'Account',
      targetId: target._id,
      targetLabel: `${target.name} (${target.email})`,
      changes: {
        deleted: { before: false, after: true },
        role: { before: target.role, after: null },
        unassignedMachines: affectedMachines.map(machine => `${machine.name} (${machine.code})`),
      },
    });
    return success(res, { id: target._id, deleted: true });
  } catch (error) { return next(error); }
};

exports.listAuditLog = async (req, res, next) => {
  try {
    const limit = Math.min(200, Math.max(1, Number.parseInt(req.query.limit, 10) || 100));
    const rows = await AdminAuditLog.find().sort({ createdAt: -1, _id: -1 }).limit(limit).lean();
    return success(res, rows);
  } catch (error) { return next(error); }
};
