const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  sku: { type: String, required: true, unique: true, trim: true, uppercase: true },
  category: { type: String, required: true, trim: true, index: true },
  description: { type: String, trim: true, maxlength: 500, default: '' },
  image: { type: String, default: '' },
  price: { type: Number, required: true, min: 0 },
  tags: { type: [String], default: [] },
  active: { type: Boolean, default: true },
}, { timestamps: true });

productSchema.index({ name: 'text', category: 'text', description: 'text', tags: 'text' });

module.exports = mongoose.model('Product', productSchema);
