const mongoose = require('mongoose');
const User = require('../models/User');
const Machine = require('../models/Machine');

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
    target.banned = req.body.banned;
    target.bannedAt = req.body.banned ? new Date() : undefined;
    await target.save();
    return success(res, publicAccount(target));
  } catch (error) { return next(error); }
};

exports.deleteUser = async (req, res, next) => {
  try {
    if (!isId(req.params.id)) return fail(res, 400, 'INVALID_ID', 'Account id is invalid.');
    if (String(req.params.id) === String(req.user._id)) return fail(res, 400, 'CANNOT_MODIFY_SELF', 'You cannot remove your own account.');
    const target = await User.findById(req.params.id).select('role');
    if (!target) return fail(res, 404, 'NOT_FOUND', 'Account not found.');
    if (target.role === 'ADMIN') return fail(res, 403, 'ADMIN_PROTECTED', 'Administrator accounts cannot be removed.');
    await User.deleteOne({ _id: target._id });
    // Machines survive vendor removal but become unassigned so an admin can hand them to another vendor.
    if (target.role === 'OPERATOR') await Machine.updateMany({ vendor: target._id }, { $set: { vendor: null } });
    return success(res, { id: target._id, deleted: true });
  } catch (error) { return next(error); }
};
