const mongoose = require('mongoose');

const productSuggestionSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
  normalizedName: { type: String, required: true, lowercase: true, trim: true },
  category: { type: String, trim: true, maxlength: 60, default: '' },
  details: { type: String, trim: true, maxlength: 500, default: '' },
  submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  votes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  status: { type: String, enum: ['OPEN', 'ADDED', 'DECLINED'], default: 'OPEN', index: true },
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reviewedAt: Date,
}, { timestamps: true });

productSuggestionSchema.index({ normalizedName: 1 }, { unique: true, partialFilterExpression: { status: 'OPEN' } });
productSuggestionSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('ProductSuggestion', productSuggestionSchema);
