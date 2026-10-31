const mongoose = require('mongoose');
const Product = require('../models/Product');
const ProductSuggestion = require('../models/ProductSuggestion');
const { recordAdminAudit } = require('../utils/adminAudit');

const success = (res, data, status = 200) => res.status(status).json({ success: true, data });
const fail = (res, status, code, message) => res.status(status).json({ success: false, error: { code, message } });
const isId = value => mongoose.Types.ObjectId.isValid(value);

function present(suggestion, userId) {
  const row = suggestion.toObject ? suggestion.toObject() : suggestion;
  return {
    _id: row._id,
    name: row.name,
    category: row.category,
    details: row.details,
    votes: row.votes.length,
    voted: userId ? row.votes.some(id => String(id?._id || id) === String(userId)) : false,
    status: row.status,
    product: row.product || null,
    createdAt: row.createdAt,
  };
}

exports.list = async (req, res, next) => {
  try {
    const query = {};
    if (['OPERATOR', 'ADMIN'].includes(req.user?.role) && req.query.status === 'OPEN') query.status = 'OPEN';
    else query.status = { $in: ['OPEN', 'ADDED'] };
    const rows = await ProductSuggestion.find(query).sort({ createdAt: -1 }).populate('product', 'name sku').limit(100);
    rows.sort((a, b) => (a.status === 'OPEN' ? 0 : 1) - (b.status === 'OPEN' ? 0 : 1) || b.votes.length - a.votes.length || b.createdAt - a.createdAt);
    return success(res, rows.map(row => present(row, req.user?._id)));
  } catch (error) { return next(error); }
};

exports.create = async (req, res, next) => {
  try {
    if (req.user.role !== 'CUSTOMER') return fail(res, 403, 'FORBIDDEN', 'Only customer accounts can submit product suggestions.');
    const body = req.body || {};
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const category = typeof body.category === 'string' ? body.category.trim() : '';
    const details = typeof body.details === 'string' ? body.details.trim() : '';
    if (name.length < 2 || name.length > 100 || category.length > 60 || details.length > 500) return fail(res, 400, 'VALIDATION_ERROR', 'Enter an item name (2–100 characters); category and details must be 60 and 500 characters or fewer.');
    const normalizedName = name.toLowerCase();
    let suggestion = await ProductSuggestion.findOneAndUpdate(
      { normalizedName, status: 'OPEN' },
      { $addToSet: { votes: req.user._id } },
      { returnDocument: 'after' },
    );
    if (suggestion) {
      return success(res, present(suggestion, req.user._id), 200);
    }
    suggestion = await ProductSuggestion.create({
      name,
      normalizedName,
      category,
      details,
      submittedBy: req.user._id,
      votes: [req.user._id],
    });
    return success(res, present(suggestion, req.user._id), 201);
  } catch (error) {
    if (error.code === 11000) {
      try {
        const suggestion = await ProductSuggestion.findOneAndUpdate(
          { normalizedName: typeof req.body?.name === 'string' ? req.body.name.trim().toLowerCase() : '', status: 'OPEN' },
          { $addToSet: { votes: req.user._id } },
          { returnDocument: 'after' },
        );
        if (suggestion) return success(res, present(suggestion, req.user._id));
      } catch (updateError) { return next(updateError); }
    }
    return next(error);
  }
};

exports.toggleVote = async (req, res, next) => {
  try {
    if (req.user.role !== 'CUSTOMER') return fail(res, 403, 'FORBIDDEN', 'Only customer accounts can vote on product suggestions.');
    if (!isId(req.params.id)) return fail(res, 400, 'INVALID_ID', 'Suggestion id is invalid.');
    const suggestion = await ProductSuggestion.findOne({ _id: req.params.id, status: 'OPEN' });
    if (!suggestion) return fail(res, 404, 'NOT_FOUND', 'Open product suggestion not found.');
    const alreadyVoted = suggestion.votes.some(id => String(id) === String(req.user._id));
    const updated = await ProductSuggestion.findOneAndUpdate(
      { _id: req.params.id, status: 'OPEN', ...(alreadyVoted ? { votes: req.user._id } : { votes: { $ne: req.user._id } }) },
      alreadyVoted ? { $pull: { votes: req.user._id } } : { $addToSet: { votes: req.user._id } },
      { returnDocument: 'after' },
    );
    const result = updated || await ProductSuggestion.findById(req.params.id);
    return result ? success(res, present(result, req.user._id)) : fail(res, 404, 'NOT_FOUND', 'Open product suggestion not found.');
  } catch (error) { return next(error); }
};

exports.review = async (req, res, next) => {
  try {
    if (!['OPERATOR', 'ADMIN'].includes(req.user.role)) return fail(res, 403, 'FORBIDDEN', 'Operator access is required to review product suggestions.');
    if (!isId(req.params.id)) return fail(res, 400, 'INVALID_ID', 'Suggestion id is invalid.');
    const { status, productId } = req.body || {};
    if (!['ADDED', 'DECLINED'].includes(status)) return fail(res, 400, 'VALIDATION_ERROR', 'Suggestion status must be ADDED or DECLINED.');
    if (status === 'ADDED' && (!isId(productId) || !(await Product.exists({ _id: productId, active: true })))) return fail(res, 400, 'PRODUCT_REQUIRED', 'Create or choose an active catalog product before marking this suggestion added.');
    const update = { status, reviewedBy: req.user._id, reviewedAt: new Date() };
    if (status === 'ADDED') update.product = productId;
    const suggestion = await ProductSuggestion.findOneAndUpdate(
      { _id: req.params.id, status: 'OPEN' },
      status === 'ADDED' ? { $set: update } : { $set: { status, reviewedBy: req.user._id, reviewedAt: update.reviewedAt }, $unset: { product: 1 } },
      { returnDocument: 'after', runValidators: true },
    ).populate('product', 'name sku');
    if (suggestion && req.user.role === 'ADMIN') await recordAdminAudit(req, {
      action: status === 'ADDED' ? 'Marked product suggestion added' : 'Declined product suggestion',
      targetType: 'Product suggestion',
      targetId: suggestion._id,
      targetLabel: suggestion.name,
      changes: {
        status: { before: 'OPEN', after: status },
        ...(status === 'ADDED' ? { product: suggestion.product?.name || String(productId) } : {}),
      },
    });
    return suggestion ? success(res, present(suggestion, req.user._id)) : fail(res, 404, 'NOT_FOUND', 'Open product suggestion not found.');
  } catch (error) { return next(error); }
};
