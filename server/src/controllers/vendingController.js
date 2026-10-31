const crypto = require('crypto');
const mongoose = require('mongoose');
const Machine = require('../models/Machine');
const Product = require('../models/Product');
const Inventory = require('../models/Inventory');
const Reservation = require('../models/Reservation');
const Alert = require('../models/Alert');
const Complaint = require('../models/Complaint');
const User = require('../models/User');
const { projectStock } = require('../utils/forecast');
const { syncOperationalAlerts } = require('../utils/inventoryAlerts');
const { releaseExpiredReservations } = require('../utils/reservationExpiry');
const { parseProductIntent, rankProduct } = require('../utils/recommendations');
const { digestPickupCode, encryptPickupCode, decryptPickupCode, verifyPickupCode } = require('../utils/pickupCode');
const { parseExpirationDate, isExpired, isNearExpiry, availableQuantity, discountedPrice, dateOnly } = require('../utils/productExpiry');
const { recordAdminAudit } = require('../utils/adminAudit');

const success = (res, data, status = 200) => res.status(status).json({ success: true, data });
const fail = (res, status, code, message) => res.status(status).json({ success: false, error: { code, message } });
const isId = value => mongoose.Types.ObjectId.isValid(value);
const reservationCode = () => `VS-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
const paymentReferenceCode = () => `PAY-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
const complaintCode = () => `VC-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
const COMPLAINT_CATEGORIES = ['ORDER', 'PAYMENT', 'MACHINE', 'OTHER'];

async function findExpiredReservationItem(reservation, now = new Date()) {
  for (const item of reservation.items) {
    const stock = await Inventory.findOne({ machine: reservation.machine, product: item.product }).select('expirationDate');
    if (stock && isExpired(stock.expirationDate, now)) return item;
  }
  return null;
}

async function expireReservationForProduct(reservation, now = new Date()) {
  const refund = reservation.status === 'PAID'
    ? { refundedAt: now, refundAmount: Math.round((reservation.total || 0) * 100) / 100 }
    : {};
  const result = await Reservation.updateOne(
    { _id: reservation._id, status: reservation.status },
    { $set: { status: 'EXPIRED', cancelledAt: now, ...refund }, $unset: { otpHash: 1, pickupOtp: 1 } },
  );
  if (!result.modifiedCount) return false;
  for (const item of reservation.items) {
    await Inventory.updateOne(
      { machine: reservation.machine, product: item.product, reserved: { $gte: item.quantity } },
      { $inc: { reserved: -item.quantity } },
    );
  }
  return true;
}

// Per-machine stock rollup used by the storefront's recommended-machine card.
const machineStockSummaries = async (machineIds) => {
  if (!machineIds.length) return new Map();
  const rows = await Inventory.find({ machine: { $in: machineIds } }).populate('product', 'name price').lean();
  const summaries = new Map();
  for (const row of rows) {
    if (!row.product) continue;
    const availableUnits = availableQuantity(row);
    const current = summaries.get(String(row.machine)) || { availableUnits: 0, topProduct: null };
    current.availableUnits += availableUnits;
    if (availableUnits > 0 && (!current.topProduct || availableUnits > current.topProduct.available)) {
      current.topProduct = {
        name: row.product.name,
        ...discountedPrice(row.product, row),
        available: availableUnits,
        expirationDate: dateOnly(row.expirationDate),
      };
    }
    summaries.set(String(row.machine), current);
  }
  return summaries;
};

exports.listMachines = async (req, res, next) => {
  try {
    const { lat, lng, radius = 25000 } = req.query;
    let machines;
    if (lat !== undefined && lng !== undefined && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) {
      machines = await Machine.find({ location: { $near: { $geometry: { type: 'Point', coordinates: [Number(lng), Number(lat)] }, $maxDistance: Math.max(100, Math.min(100000, Number(radius) || 25000)) } } }).populate('vendor', 'name');
    } else {
      machines = await Machine.find().populate('vendor', 'name').sort({ status: 1, name: 1 });
    }
    const summaries = await machineStockSummaries(machines.map(machine => machine._id));
    return success(res, machines.map(machine => ({ ...machine.toObject(), ...(summaries.get(String(machine._id)) || { availableUnits: 0 }) })));
  } catch (error) { return next(error); }
};

exports.getMachine = async (req, res, next) => {
  try {
    if (!isId(req.params.id)) return fail(res, 400, 'INVALID_ID', 'Machine id is invalid.');
    const machine = await Machine.findById(req.params.id).populate('vendor', 'name');
    if (!machine) return fail(res, 404, 'NOT_FOUND', 'Machine not found.');
    return success(res, machine);
  } catch (error) { return next(error); }
};

exports.createMachine = async (req, res, next) => {
  try {
    const { name, code, description, address, latitude, longitude, capacity, vendorId } = req.body;
    if (typeof name !== 'string' || name.trim().length < 2 || name.length > 100 || typeof code !== 'string' || !/^[a-z0-9-]{3,30}$/i.test(code) || typeof address !== 'string' || !address.trim() || address.length > 200 || !Number.isFinite(Number(latitude)) || Math.abs(Number(latitude)) > 90 || !Number.isFinite(Number(longitude)) || Math.abs(Number(longitude)) > 180 || (capacity !== undefined && (!Number.isInteger(Number(capacity)) || Number(capacity) < 1 || Number(capacity) > 10000))) return fail(res, 400, 'VALIDATION_ERROR', 'Name, code, address, latitude and longitude are required.');
    if (req.user.role === 'ADMIN' && vendorId && (!isId(vendorId) || !(await User.exists({ _id: vendorId, role: 'OPERATOR', banned: { $ne: true } })))) return fail(res, 400, 'VALIDATION_ERROR', 'Choose an active operator account for this machine.');
    const vendor = req.user.role === 'OPERATOR' ? req.user._id : vendorId || undefined;
    const machine = await Machine.create({ name, code, description, address, location: { type: 'Point', coordinates: [Number(longitude), Number(latitude)] }, capacity, vendor });
    await recordAdminAudit(req, {
      action: 'Created machine',
      targetType: 'Machine',
      targetId: machine._id,
      targetLabel: `${machine.name} (${machine.code})`,
      changes: {
        name: machine.name,
        code: machine.code,
        description: machine.description,
        address: machine.address,
        coordinates: machine.location.coordinates,
        capacity: machine.capacity,
        vendor: String(machine.vendor || ''),
      },
    });
    return success(res, machine, 201);
  } catch (error) { return next(error); }
};

exports.updateMachine = async (req, res, next) => {
  try {
    if (!isId(req.params.id)) return fail(res, 400, 'INVALID_ID', 'Machine id is invalid.');
    if (req.user.role === 'OPERATOR' && !(await Machine.exists({ _id: req.params.id, vendor: req.user._id }))) return fail(res, 403, 'FORBIDDEN', 'You can only update machines assigned to your operator account.');
    if (req.body.status !== undefined && !['ONLINE', 'OFFLINE', 'MAINTENANCE'].includes(req.body.status)) return fail(res, 400, 'VALIDATION_ERROR', 'Machine status is invalid.');
    const allowed = ['name', 'description', 'address', 'status', 'capacity'];
    const update = Object.fromEntries(Object.entries(req.body).filter(([key]) => allowed.includes(key)));
    if (req.body.vendorId !== undefined) {
      if (req.user.role !== 'ADMIN') return fail(res, 403, 'FORBIDDEN', 'Only an administrator can reassign a machine to a vendor.');
      if (req.body.vendorId && (!isId(req.body.vendorId) || !(await User.exists({ _id: req.body.vendorId, role: 'OPERATOR', banned: { $ne: true } })))) return fail(res, 400, 'VALIDATION_ERROR', 'Choose an active operator account for this machine.');
      update.vendor = req.body.vendorId || null;
    }
    if (update.capacity !== undefined && (!Number.isInteger(Number(update.capacity)) || Number(update.capacity) < 1 || Number(update.capacity) > 10000)) return fail(res, 400, 'VALIDATION_ERROR', 'Capacity must be a whole number between 1 and 10000.');
    if (update.name !== undefined && (typeof update.name !== 'string' || update.name.trim().length < 2 || update.name.length > 100)) return fail(res, 400, 'VALIDATION_ERROR', 'Machine name must be between 2 and 100 characters.');
    if (update.address !== undefined && (typeof update.address !== 'string' || !update.address.trim() || update.address.length > 200)) return fail(res, 400, 'VALIDATION_ERROR', 'Machine address must be between 1 and 200 characters.');
    if (update.description !== undefined && (typeof update.description !== 'string' || update.description.length > 500)) return fail(res, 400, 'VALIDATION_ERROR', 'Machine description must be 500 characters or fewer.');
    if (req.body.latitude !== undefined || req.body.longitude !== undefined) {
      const current = await Machine.findById(req.params.id);
      if (!current) return fail(res, 404, 'NOT_FOUND', 'Machine not found.');
      const latitude = Number(req.body.latitude ?? current.location.coordinates[1]);
      const longitude = Number(req.body.longitude ?? current.location.coordinates[0]);
      if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180) return fail(res, 400, 'VALIDATION_ERROR', 'Latitude must be between -90 and 90 and longitude between -180 and 180.');
      update.location = { type: 'Point', coordinates: [longitude, latitude] };
    }
    const previous = req.user.role === 'ADMIN' ? await Machine.findById(req.params.id) : null;
    const machine = await Machine.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });
    if (machine && previous) {
      const changes = {};
      for (const [field, value] of Object.entries(update)) {
        const before = field === 'location' ? previous.location?.coordinates : previous[field];
        const after = field === 'location' ? value.coordinates : machine[field];
        if (JSON.stringify(before) !== JSON.stringify(after)) changes[field] = { before: before ?? null, after: after ?? null };
      }
      if (Object.keys(changes).length) await recordAdminAudit(req, {
        action: 'Updated machine',
        targetType: 'Machine',
        targetId: machine._id,
        targetLabel: `${machine.name} (${machine.code})`,
        changes,
      });
    }
    return machine ? success(res, machine) : fail(res, 404, 'NOT_FOUND', 'Machine not found.');
  } catch (error) { return next(error); }
};

exports.deleteMachine = async (req, res, next) => {
  try {
    if (!isId(req.params.id)) return fail(res, 400, 'INVALID_ID', 'Machine id is invalid.');
    const activeOrders = await Reservation.exists({ machine: req.params.id, status: { $in: ['PENDING', 'PAID'] } });
    if (activeOrders) return fail(res, 409, 'MACHINE_HAS_ACTIVE_ORDERS', 'This vendor still has active orders. Let them expire or be picked up before removing it.');
    const machine = await Machine.findById(req.params.id);
    if (!machine) return fail(res, 404, 'NOT_FOUND', 'Machine not found.');
    // Removing a vendor clears its shelf and alerts; past orders stay for history.
    const removedInventory = await Inventory.deleteMany({ machine: machine._id });
    const removedAlerts = await Alert.deleteMany({ machine: machine._id });
    await Machine.deleteOne({ _id: machine._id });
    await recordAdminAudit(req, {
      action: 'Deleted machine',
      targetType: 'Machine',
      targetId: machine._id,
      targetLabel: `${machine.name} (${machine.code})`,
      changes: {
        deleted: { before: false, after: true },
        inventoryRowsRemoved: removedInventory.deletedCount,
        alertsRemoved: removedAlerts.deletedCount,
      },
    });
    return success(res, { id: machine.id, deleted: true });
  } catch (error) { return next(error); }
};

exports.listProducts = async (req, res, next) => {
  try {
    const { search, category, machineId } = req.query;
    const query = { active: true };
    if (category) query.category = String(category).slice(0, 80);
    if (search) query.$text = { $search: String(search).slice(0, 100) };
    let products = await Product.find(query).sort({ category: 1, name: 1 }).limit(100);
    if (machineId) {
      if (!isId(machineId)) return fail(res, 400, 'INVALID_ID', 'Machine id is invalid.');
      const stocks = await Inventory.find({ machine: machineId, product: { $in: products.map(product => product._id) } }).lean();
      const stockByProduct = new Map(stocks.map(stock => [String(stock.product), stock]));
      products = products.map(product => {
        const stock = stockByProduct.get(String(product._id));
        return {
          ...product.toObject(),
          available: stock ? availableQuantity(stock) : 0,
          expirationDate: stock ? dateOnly(stock.expirationDate) : null,
          expired: stock ? isExpired(stock.expirationDate) : false,
          ...(stock ? discountedPrice(product, stock) : {}),
        };
      });
    }
    return success(res, products);
  } catch (error) { return next(error); }
};

exports.recommendProducts = async (req, res, next) => {
  try {
    const intent = parseProductIntent(req.query.prompt);
    if (!intent.query) return success(res, { intent, recommendations: [] });
    const products = await Product.find({ active: true }).sort({ name: 1 }).limit(100);
    let stockByProduct = new Map();
    if (req.query.machineId) {
      if (!isId(req.query.machineId)) return fail(res, 400, 'INVALID_ID', 'Machine id is invalid.');
      const stocks = await Inventory.find({ machine: req.query.machineId, product: { $in: products.map(product => product._id) } }).lean();
      stockByProduct = new Map(stocks.map(stock => [String(stock.product), stock]));
    }
    const recommendations = products.map(product => {
      const stock = stockByProduct.get(String(product._id));
      const available = req.query.machineId ? (stock ? availableQuantity(stock) : 0) : undefined;
      const pricedProduct = req.query.machineId && stock
        ? { ...product.toObject(), expirationDate: dateOnly(stock.expirationDate), expired: isExpired(stock.expirationDate), ...discountedPrice(product, stock) }
        : product.toObject();
      return { product: pricedProduct, available, score: rankProduct(pricedProduct, intent, available) };
    }).filter(row => row.score >= 0 && row.available !== 0).sort((a, b) => b.score - a.score || a.product.name.localeCompare(b.product.name)).slice(0, 12);
    if (intent.words.length && !intent.categories.length && !intent.tags.length && recommendations.every(row => row.score === 0)) return success(res, { intent, recommendations: [] });
    return success(res, { intent, recommendations });
  } catch (error) { return next(error); }
};

exports.createProduct = async (req, res, next) => {
  try {
    const { name, sku, category, description = '', price, image = '', tags = [] } = req.body;
    if (typeof name !== 'string' || name.trim().length < 2 || name.length > 120 || typeof sku !== 'string' || !/^[a-z0-9_-]{2,40}$/i.test(sku) || typeof category !== 'string' || category.trim().length < 2 || category.length > 80 || !Number.isFinite(Number(price)) || Number(price) < 0 || Number(price) > 100000 || typeof description !== 'string' || description.length > 500 || typeof image !== 'string' || image.length > 2048 || !Array.isArray(tags) || tags.length > 20 || tags.some(tag => typeof tag !== 'string' || tag.length > 32)) return fail(res, 400, 'VALIDATION_ERROR', 'Name, SKU, category and a non-negative price are required.');
    const product = await Product.create({ name, sku, category, description, price: Number(price), image, tags: Array.isArray(tags) ? tags : [] });
    await recordAdminAudit(req, {
      action: 'Created product',
      targetType: 'Product',
      targetId: product._id,
      targetLabel: `${product.name} (${product.sku})`,
      changes: {
        name: product.name,
        sku: product.sku,
        category: product.category,
        description: product.description,
        price: product.price,
        image: product.image,
        tags: product.tags,
      },
    });
    return success(res, product, 201);
  } catch (error) { return next(error); }
};

exports.updateProduct = async (req, res, next) => {
  try {
    if (!isId(req.params.id)) return fail(res, 400, 'INVALID_ID', 'Product id is invalid.');
    const allowed = ['name', 'category', 'description', 'price', 'image', 'tags', 'active'];
    const update = Object.fromEntries(Object.entries(req.body).filter(([key]) => allowed.includes(key)));
    if (update.name !== undefined && (typeof update.name !== 'string' || update.name.trim().length < 2 || update.name.length > 120)) return fail(res, 400, 'VALIDATION_ERROR', 'Product name must be between 2 and 120 characters.');
    if (update.category !== undefined && (typeof update.category !== 'string' || update.category.trim().length < 2 || update.category.length > 80)) return fail(res, 400, 'VALIDATION_ERROR', 'Product category must be between 2 and 80 characters.');
    if (update.description !== undefined && (typeof update.description !== 'string' || update.description.length > 500)) return fail(res, 400, 'VALIDATION_ERROR', 'Product description must be 500 characters or fewer.');
    if (update.image !== undefined && (typeof update.image !== 'string' || update.image.length > 2048)) return fail(res, 400, 'VALIDATION_ERROR', 'Product image must be a URL or image label of 2048 characters or fewer.');
    if (update.price !== undefined && (!Number.isFinite(Number(update.price)) || Number(update.price) < 0 || Number(update.price) > 100000)) return fail(res, 400, 'VALIDATION_ERROR', 'Product price must be between 0 and 100000.');
    if (update.tags !== undefined && (!Array.isArray(update.tags) || update.tags.length > 20 || update.tags.some(tag => typeof tag !== 'string' || tag.trim().length > 32))) return fail(res, 400, 'VALIDATION_ERROR', 'Products may have up to 20 tags of 32 characters each.');
    if (update.active !== undefined && typeof update.active !== 'boolean') return fail(res, 400, 'VALIDATION_ERROR', 'Product active must be a boolean.');
    if (update.active === false) {
      const hasStock = await Inventory.exists({ product: req.params.id, quantity: { $gt: 0 } });
      if (hasStock) return fail(res, 409, 'PRODUCT_HAS_STOCK', 'Remove all on-hand inventory before archiving this product.');
    }
    const previous = req.user.role === 'ADMIN' ? await Product.findById(req.params.id) : null;
    const product = await Product.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });
    if (product && previous) {
      const changes = {};
      for (const [field, after] of Object.entries(update)) {
        const before = previous[field];
        if (JSON.stringify(before) !== JSON.stringify(after)) changes[field] = { before: before ?? null, after };
      }
      if (Object.keys(changes).length) await recordAdminAudit(req, {
        action: 'Updated product',
        targetType: 'Product',
        targetId: product._id,
        targetLabel: `${product.name} (${product.sku})`,
        changes,
      });
    }
    return product ? success(res, product) : fail(res, 404, 'NOT_FOUND', 'Product not found.');
  } catch (error) { return next(error); }
};

exports.deleteProduct = async (req, res, next) => {
  try {
    if (!isId(req.params.id)) return fail(res, 400, 'INVALID_ID', 'Product id is invalid.');
    const hasStock = await Inventory.exists({ product: req.params.id, quantity: { $gt: 0 } });
    if (hasStock) return fail(res, 409, 'PRODUCT_HAS_STOCK', 'Remove all on-hand inventory before archiving this product.');
    const previous = req.user.role === 'ADMIN' ? await Product.findById(req.params.id) : null;
    const product = await Product.findByIdAndUpdate(req.params.id, { active: false }, { new: true });
    if (product && previous?.active) await recordAdminAudit(req, {
      action: 'Archived product',
      targetType: 'Product',
      targetId: product._id,
      targetLabel: `${product.name} (${product.sku})`,
      changes: { active: { before: true, after: false } },
    });
    return product ? success(res, product) : fail(res, 404, 'NOT_FOUND', 'Product not found.');
  } catch (error) { return next(error); }
};

exports.listFavorites = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).populate('favorites', 'name sku category description price image tags active');
    const favorites = (user?.favorites || []).filter(product => product && product.active);
    return success(res, favorites);
  } catch (error) { return next(error); }
};

exports.addFavorite = async (req, res, next) => {
  try {
    const { productId } = req.body;
    if (!isId(productId)) return fail(res, 400, 'VALIDATION_ERROR', 'A valid productId is required.');
    const product = await Product.findOne({ _id: productId, active: true });
    if (!product) return fail(res, 404, 'NOT_FOUND', 'Active product not found.');
    await User.updateOne({ _id: req.user._id }, { $addToSet: { favorites: product._id } });
    return success(res, { productId: product.id, favorite: true }, 201);
  } catch (error) { return next(error); }
};

exports.removeFavorite = async (req, res, next) => {
  try {
    if (!isId(req.params.productId)) return fail(res, 400, 'VALIDATION_ERROR', 'A valid product id is required.');
    await User.updateOne({ _id: req.user._id }, { $pull: { favorites: req.params.productId } });
    return success(res, { productId: req.params.productId, favorite: false });
  } catch (error) { return next(error); }
};

exports.listInventory = async (req, res, next) => {
  try {
    const query = {};
    if (req.query.machineId) query.machine = req.query.machineId;
    if (req.query.productId) query.product = req.query.productId;
    // A vendor only sees the shelves of machines assigned to them.
    if (req.user.role === 'OPERATOR') {
      const owned = await Machine.find({ vendor: req.user._id }).distinct('_id');
      if (query.machine) {
        if (!owned.some(id => String(id) === String(query.machine))) return success(res, []);
      } else {
        query.machine = { $in: owned };
      }
    }
    const rows = await Inventory.find(query).populate('machine', 'name code status address').populate('product', 'name sku category price image').sort({ updatedAt: -1 });
    return success(res, rows);
  } catch (error) { return next(error); }
};

exports.updateInventory = async (req, res, next) => {
  try {
    const { machineId, productId, quantity, lowStockThreshold, slot, expirationDate, discountPercent } = req.body;
    if (!isId(machineId) || !isId(productId) || !Number.isInteger(Number(quantity)) || Number(quantity) < 0) return fail(res, 400, 'VALIDATION_ERROR', 'Valid machineId, productId and non-negative integer quantity are required.');
    if (!(await Machine.exists({ _id: machineId })) || !(await Product.exists({ _id: productId, active: true }))) return fail(res, 404, 'NOT_FOUND', 'Machine or active product not found.');
    if (req.user.role === 'OPERATOR' && !(await Machine.exists({ _id: machineId, vendor: req.user._id }))) return fail(res, 403, 'FORBIDDEN', 'This machine is not assigned to your vendor account.');
    const current = req.params.id
      ? await Inventory.findById(req.params.id)
      : await Inventory.findOne({ machine: machineId, product: productId });
    if (req.params.id && !current) return fail(res, 404, 'NOT_FOUND', 'Inventory row not found.');
    if (current && (String(current.machine) !== String(machineId) || String(current.product) !== String(productId))) return fail(res, 409, 'INVENTORY_KEY_IMMUTABLE', 'Machine and product cannot be changed on an existing inventory row.');
    if (current && Number(quantity) < current.reserved) return fail(res, 409, 'STOCK_RESERVED', 'Quantity cannot be lower than stock already reserved by customers.');
    if (lowStockThreshold !== undefined && (!Number.isInteger(Number(lowStockThreshold)) || Number(lowStockThreshold) < 0)) return fail(res, 400, 'VALIDATION_ERROR', 'lowStockThreshold must be a non-negative integer.');
    const parsedExpiration = expirationDate === undefined ? current?.expirationDate ?? null : parseExpirationDate(expirationDate);
    if (expirationDate !== undefined && parsedExpiration === undefined) return fail(res, 400, 'VALIDATION_ERROR', 'expirationDate must be a valid YYYY-MM-DD date or blank.');
    if (!current && Number(quantity) > 0 && !parsedExpiration) return fail(res, 400, 'EXPIRATION_REQUIRED', 'Set an expiration date before adding new stock.');
    if (current && Number(quantity) > current.quantity && !parsedExpiration) return fail(res, 400, 'EXPIRATION_REQUIRED', 'Set an expiration date before adding more stock to this shelf.');
    if (current && Number(quantity) > current.quantity && expirationDate === undefined) return fail(res, 400, 'EXPIRATION_REQUIRED', 'Confirm the expiration date when adding stock to an existing shelf.');
    if (current?.expirationDate && expirationDate !== undefined && !parsedExpiration && Number(quantity) > 0) return fail(res, 400, 'EXPIRATION_REQUIRED', 'Stock with an expiration date cannot be changed to undated stock.');
    if (Number(quantity) > (current?.quantity || 0) && parsedExpiration && isExpired(parsedExpiration)) return fail(res, 400, 'PRODUCT_EXPIRED', 'Expired stock cannot be added to inventory.');
    if (current?.quantity > 0 && current.expirationDate && Number(quantity) > current.quantity && parsedExpiration?.getTime() !== current.expirationDate.getTime()) return fail(res, 409, 'EXPIRATION_BATCH_MISMATCH', 'This shelf tracks one expiration date for all units. Remove or sell the current stock before adding a different-expiry batch.');
    const nextDiscount = discountPercent === undefined ? Number(current?.discountPercent || 0) : Number(discountPercent);
    if (!Number.isInteger(nextDiscount) || nextDiscount < 0 || nextDiscount > 90) return fail(res, 400, 'VALIDATION_ERROR', 'discountPercent must be a whole number between 0 and 90.');
    if (discountPercent !== undefined && nextDiscount > 0 && !isNearExpiry(parsedExpiration)) return fail(res, 400, 'DISCOUNT_WINDOW_CLOSED', 'Discounts can only be set when a product expires within the next 7 days.');
    const row = await Inventory.findOneAndUpdate({ machine: machineId, product: productId, ...(current ? { reserved: { $lte: Number(quantity) } } : {}) }, { $set: { quantity: Number(quantity), discountPercent: nextDiscount, expirationDate: parsedExpiration, ...(lowStockThreshold !== undefined ? { lowStockThreshold: Number(lowStockThreshold) } : {}), ...(slot !== undefined ? { slot: String(slot).slice(0, 20) } : {}) }, $setOnInsert: { reserved: 0 } }, { new: true, upsert: true, runValidators: true });
    if (!row) return fail(res, 409, 'STOCK_RESERVED', 'Quantity cannot be lower than stock already reserved by customers.');
    await row.populate('machine product');
    await syncOperationalAlerts();
    if (req.user.role === 'ADMIN') await recordAdminAudit(req, {
      action: current ? 'Updated inventory' : 'Added inventory',
      targetType: 'Inventory',
      targetId: row._id,
      targetLabel: `${row.product.name} at ${row.machine.name}`,
      changes: {
        quantity: { before: current?.quantity ?? 0, after: row.quantity },
        lowStockThreshold: { before: current?.lowStockThreshold ?? 5, after: row.lowStockThreshold },
        slot: { before: current?.slot || '', after: row.slot || '' },
        expirationDate: { before: current?.expirationDate || null, after: row.expirationDate || null },
        discountPercent: { before: current?.discountPercent || 0, after: row.discountPercent || 0 },
      },
    });
    return success(res, row, current ? 200 : 201);
  } catch (error) { return next(error); }
};

exports.deleteInventory = async (req, res, next) => {
  try {
    if (!isId(req.params.id)) return fail(res, 400, 'INVALID_ID', 'Inventory id is invalid.');
    const row = await Inventory.findById(req.params.id);
    if (!row || row.reserved > 0) return fail(res, 404, 'NOT_FOUND', 'Inventory row was not found or has active reservations.');
    if (req.user.role === 'OPERATOR' && !(await Machine.exists({ _id: row.machine, vendor: req.user._id }))) return fail(res, 403, 'FORBIDDEN', 'This machine is not assigned to your vendor account.');
    if (req.user.role === 'ADMIN') await row.populate('machine product');
    await row.deleteOne();
    await syncOperationalAlerts();
    await recordAdminAudit(req, {
      action: 'Removed inventory',
      targetType: 'Inventory',
      targetId: row._id,
      targetLabel: `${row.product?.name || 'Product'} at ${row.machine?.name || 'machine'}`,
      changes: {
        deleted: { before: false, after: true },
        quantity: row.quantity,
        expirationDate: row.expirationDate || null,
        discountPercent: row.discountPercent || 0,
      },
    });
    return success(res, { id: row.id, deleted: true });
  } catch (error) { return next(error); }
};

exports.createReservation = async (req, res, next) => {
  const holds = [];
  try {
    await releaseExpiredReservations();
    const { machineId, items, paymentMethod = 'DEMO' } = req.body;
    if (!isId(machineId) || !Array.isArray(items) || items.length < 1 || items.length > 20) return fail(res, 400, 'VALIDATION_ERROR', 'Choose a machine and between 1 and 20 items.');
    const machine = await Machine.findById(machineId);
    if (!machine || machine.status !== 'ONLINE') return fail(res, 409, 'MACHINE_UNAVAILABLE', 'This machine is currently unavailable.');
    const normalized = new Map();
    for (const item of items) {
      const productId = String(item.productId || '');
      const quantity = Number(item.quantity);
      if (!isId(productId) || !Number.isInteger(quantity) || quantity < 1 || quantity > 20) return fail(res, 400, 'VALIDATION_ERROR', 'Each item needs a valid product and a quantity between 1 and 20.');
      normalized.set(productId, (normalized.get(productId) || 0) + quantity);
    }
    const products = await Product.find({ _id: { $in: [...normalized.keys()] }, active: true });
    if (products.length !== normalized.size) return fail(res, 400, 'INVALID_PRODUCT', 'One or more products are unavailable.');
    const byId = new Map(products.map(product => [String(product._id), product]));
    const lines = [];
    for (const [productId, quantity] of normalized) {
      const now = new Date();
      const stock = await Inventory.findOneAndUpdate({ machine: machineId, product: productId, $expr: { $gte: [{ $subtract: ['$quantity', '$reserved'] }, quantity] }, $or: [{ expirationDate: { $exists: false } }, { expirationDate: null }, { expirationDate: { $gte: now } }] }, { $inc: { reserved: quantity } }, { new: true });
      if (!stock) {
        for (const hold of holds) await Inventory.updateOne({ _id: hold.id }, { $inc: { reserved: -hold.quantity } });
        const existingStock = await Inventory.findOne({ machine: machineId, product: productId }).lean();
        if (existingStock && isExpired(existingStock.expirationDate, now)) return fail(res, 409, 'PRODUCT_EXPIRED', `${byId.get(productId).name} has expired and cannot be reserved.`);
        return fail(res, 409, 'INSUFFICIENT_STOCK', `${byId.get(productId).name} is no longer available in the requested quantity.`);
      }
      holds.push({ id: stock._id, quantity });
      const product = byId.get(productId);
      const pricing = discountedPrice(product, stock);
      lines.push({ product: product._id, name: product.name, sku: product.sku, quantity, unitPrice: pricing.price, ...(pricing.discountPercent ? { discountPercent: pricing.discountPercent } : {}), expirationDate: dateOnly(stock.expirationDate) });
    }
    const total = Math.round(lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0) * 100) / 100;
    const requestedMethod = ['CARD', 'UPI', 'CASHLESS'].includes(paymentMethod) ? paymentMethod : 'DEMO';
    const demoPaid = process.env.DEMO_MODE !== 'false' && requestedMethod === 'DEMO';
    const otp = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const reference = demoPaid ? paymentReferenceCode() : undefined;
    const reservation = await Reservation.create({ code: reservationCode(), customer: req.user._id, machine: machineId, items: lines, total, paymentMethod: requestedMethod, status: demoPaid ? 'PAID' : 'PENDING', ...(demoPaid ? { paymentReference: reference, paidAt: new Date() } : {}), otpHash: demoPaid ? digestPickupCode(otp) : undefined, pickupOtp: demoPaid ? encryptPickupCode(otp) : undefined, otpExpiresAt: new Date(Date.now() + 15 * 60 * 1000) });
    return success(res, { ...reservation.toObject(), otp: demoPaid ? otp : undefined, pickupOtp: undefined, payment: demoPaid ? { provider: 'DEMO', status: 'PAID', reference } : { provider: requestedMethod, status: 'PENDING', message: `Stock is held for 15 minutes. Complete payment by ${requestedMethod === 'UPI' ? 'UPI' : 'card'} to get your pickup code.` } }, 201);
  } catch (error) {
    for (const hold of holds) await Inventory.updateOne({ _id: hold.id }, { $inc: { reserved: -hold.quantity } }).catch(() => {});
    return next(error);
  }
};

exports.payReservation = async (req, res, next) => {
  try {
    if (!isId(req.params.id)) return fail(res, 400, 'INVALID_ID', 'Reservation id is invalid.');
    await releaseExpiredReservations();
    const method = String(req.body.method || '').toUpperCase();
    if (!['CARD', 'UPI'].includes(method)) return fail(res, 400, 'VALIDATION_ERROR', 'Choose a payment method: CARD or UPI.');
    const last4 = String(req.body.last4 || '');
    const upiId = String(req.body.upiId || '').trim();
    if (method === 'CARD' && !/^\d{4}$/.test(last4)) return fail(res, 400, 'VALIDATION_ERROR', 'The card number is incomplete.');
    if (method === 'UPI' && !/^[a-z0-9._-]{2,64}@[a-z]{2,32}$/i.test(upiId)) return fail(res, 400, 'VALIDATION_ERROR', 'Enter a valid UPI ID, for example name@bank.');
    const pending = await Reservation.findOne({ _id: req.params.id, customer: req.user._id, status: 'PENDING' });
    if (pending && await findExpiredReservationItem(pending)) {
      await expireReservationForProduct(pending);
      return fail(res, 409, 'PRODUCT_EXPIRED', 'A product in this order has expired. The reservation was cancelled and its stock hold released.');
    }
    const otp = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const reference = paymentReferenceCode();
    const now = new Date();
    const row = await Reservation.findOneAndUpdate(
      { _id: req.params.id, customer: req.user._id, status: 'PENDING', otpExpiresAt: { $gt: now } },
      { $set: { status: 'PAID', paymentMethod: method, ...(method === 'CARD' ? { paymentLast4: last4 } : {}), paymentReference: reference, paidAt: now, otpHash: digestPickupCode(otp), pickupOtp: encryptPickupCode(otp), otpExpiresAt: new Date(now.getTime() + 15 * 60 * 1000) } },
      { new: true }
    );
    if (!row) {
      const existing = await Reservation.findById(req.params.id).select('customer status');
      if (!existing) return fail(res, 404, 'NOT_FOUND', 'Reservation not found.');
      if (String(existing.customer) !== String(req.user._id)) return fail(res, 403, 'FORBIDDEN', 'You do not have access to this reservation.');
      if (existing.status === 'PAID') return fail(res, 409, 'ALREADY_PAID', 'This order is already paid.');
      return fail(res, 409, 'PAYMENT_WINDOW_CLOSED', `This order is ${existing.status.toLowerCase()} and can no longer be paid.`);
    }
    return success(res, { ...row.toObject(), otp, pickupOtp: undefined, payment: { provider: method, status: 'PAID', reference, ...(method === 'CARD' ? { last4 } : {}) } });
  } catch (error) { return next(error); }
};

exports.listReservations = async (req, res, next) => {
  try {
    await releaseExpiredReservations();
    const query = req.user.role === 'ADMIN' || req.user.role === 'OPERATOR' ? {} : { customer: req.user._id };
    if (req.query.status && ['PENDING', 'PAID', 'DISPENSED', 'CANCELLED', 'EXPIRED'].includes(req.query.status)) query.status = req.query.status;
    const rows = await Reservation.find(query).select('+pickupOtp').populate('customer', 'name email').populate('machine', 'name code address').sort({ createdAt: -1 }).limit(100);
    const result = rows.map(row => {
      const data = row.toObject();
      if (data.pickupOtp) data.pickupOtp = decryptPickupCode(data.pickupOtp);
      return data;
    });
    return success(res, result);
  } catch (error) { return next(error); }
};

exports.getReservation = async (req, res, next) => {
  try {
    if (!isId(req.params.id)) return fail(res, 400, 'INVALID_ID', 'Reservation id is invalid.');
    const row = await Reservation.findById(req.params.id).select('+pickupOtp').populate('machine', 'name code address').populate('customer', 'name email');
    if (!row) return fail(res, 404, 'NOT_FOUND', 'Reservation not found.');
    if (!['ADMIN', 'OPERATOR'].includes(req.user.role) && String(row.customer._id) !== String(req.user._id)) return fail(res, 403, 'FORBIDDEN', 'You do not have access to this reservation.');
    const data = row.toObject();
    if (data.pickupOtp) data.pickupOtp = decryptPickupCode(data.pickupOtp);
    return success(res, data);
  } catch (error) { return next(error); }
};

exports.cancelReservation = async (req, res, next) => {
  try {
    if (!isId(req.params.id)) return fail(res, 400, 'INVALID_ID', 'Reservation id is invalid.');
    await releaseExpiredReservations();
    const row = await Reservation.findOneAndUpdate({ _id: req.params.id, customer: req.user._id, status: { $in: ['PENDING', 'PAID'] }, otpExpiresAt: { $gt: new Date() } }, { $set: { status: 'CANCELLED', cancelledAt: new Date() }, $unset: { otpHash: 1, pickupOtp: 1 } }, { new: true });
    if (!row) return fail(res, 404, 'NOT_FOUND', 'An active reservation was not found.');
    for (const item of row.items) await Inventory.updateOne({ machine: row.machine, product: item.product, reserved: { $gte: item.quantity } }, { $inc: { reserved: -item.quantity } });
    return success(res, row);
  } catch (error) { return next(error); }
};

exports.dispenseReservation = async (req, res, next) => {
  try {
    if (!isId(req.params.id)) return fail(res, 400, 'INVALID_ID', 'Reservation id is invalid.');
    await releaseExpiredReservations();
    const row = await Reservation.findById(req.params.id).select('+otpHash');
    if (!row) return fail(res, 404, 'NOT_FOUND', 'Reservation not found.');
    if (!['ADMIN', 'OPERATOR'].includes(req.user.role) && String(row.customer) !== String(req.user._id)) return fail(res, 403, 'FORBIDDEN', 'You do not have access to this reservation.');
    if (row.status !== 'PAID') return fail(res, 409, 'INVALID_RESERVATION_STATE', `Reservation is ${row.status.toLowerCase()} and cannot be dispensed.`);
    if (!row.otpExpiresAt || row.otpExpiresAt <= new Date()) {
      await releaseExpiredReservations();
      return fail(res, 410, 'OTP_EXPIRED', 'This pickup code has expired and its stock hold was released.');
    }
    const otp = String(req.body.otp || '');
    if (!/^\d{6}$/.test(otp) || !verifyPickupCode(otp, row.otpHash)) return fail(res, 401, 'INVALID_OTP', 'The pickup code is incorrect.');
    if (await findExpiredReservationItem(row)) {
      await expireReservationForProduct(row);
      return fail(res, 409, 'PRODUCT_EXPIRED', 'A product in this order has expired. The reservation was cancelled and the simulated payment was refunded.');
    }
    const claimed = await Reservation.findOneAndUpdate({ _id: row._id, status: 'PAID', otpHash: row.otpHash, otpExpiresAt: { $gt: new Date() } }, { $set: { status: 'DISPENSED', dispensedAt: new Date() }, $unset: { otpHash: 1, pickupOtp: 1 } }, { new: true }).select('+pickupOtp');
    if (!claimed) return fail(res, 409, 'ALREADY_DISPENSED', 'This reservation has already been dispensed or changed.');
    const deducted = [];
    for (const item of row.items) {
      const result = await Inventory.updateOne({ machine: row.machine, product: item.product, quantity: { $gte: item.quantity }, reserved: { $gte: item.quantity }, $or: [{ expirationDate: { $exists: false } }, { expirationDate: null }, { expirationDate: { $gte: new Date() } }] }, { $inc: { quantity: -item.quantity, reserved: -item.quantity } });
      if (!result.modifiedCount) {
        for (const previous of deducted) await Inventory.updateOne({ machine: row.machine, product: previous.product }, { $inc: { quantity: previous.quantity, reserved: previous.quantity } });
        await Reservation.updateOne({ _id: row._id, status: 'DISPENSED' }, { $set: { status: 'PAID', dispensedAt: null, otpHash: row.otpHash, pickupOtp: encryptPickupCode(otp) } });
        return fail(res, 409, 'INVENTORY_MISMATCH', 'Inventory changed unexpectedly; please contact an operator.');
      }
      deducted.push({ quantity: item.quantity, product: item.product });
    }
    return success(res, { ...claimed.toObject(), message: 'Pickup verified. Your order has been dispensed.' });
  } catch (error) { return next(error); }
};

exports.createComplaint = async (req, res, next) => {
  try {
    const category = String(req.body.category || '').toUpperCase();
    const subject = String(req.body.subject || '').trim();
    const message = String(req.body.message || '').trim();
    if (!COMPLAINT_CATEGORIES.includes(category)) return fail(res, 400, 'VALIDATION_ERROR', 'Choose what your problem is about.');
    if (subject.length < 4 || subject.length > 120) return fail(res, 400, 'VALIDATION_ERROR', 'Give your problem a short title between 4 and 120 characters.');
    if (message.length < 20 || message.length > 2000) return fail(res, 400, 'VALIDATION_ERROR', 'Describe the problem in 20 to 2000 characters.');
    let reservation = null;
    if (req.body.reservationId) {
      if (!isId(req.body.reservationId)) return fail(res, 400, 'VALIDATION_ERROR', 'The selected order is invalid.');
      reservation = await Reservation.findOne({ _id: req.body.reservationId, customer: req.user._id }).select('machine code');
      if (!reservation) return fail(res, 404, 'NOT_FOUND', 'That order was not found on your account.');
    }
    let machineId = reservation?.machine;
    if (!machineId && req.body.machineId) {
      if (!isId(req.body.machineId) || !(await Machine.exists({ _id: req.body.machineId }))) return fail(res, 400, 'VALIDATION_ERROR', 'The selected machine is invalid.');
      machineId = req.body.machineId;
    }
    const complaint = await Complaint.create({ reference: complaintCode(), customer: req.user._id, reservation: reservation?._id, machine: machineId, category, subject, message });
    return success(res, complaint, 201);
  } catch (error) { return next(error); }
};

exports.listComplaints = async (req, res, next) => {
  try {
    const staff = ['ADMIN', 'OPERATOR'].includes(req.user.role);
    const query = staff ? {} : { customer: req.user._id };
    if (req.query.status && ['OPEN', 'RESOLVED'].includes(req.query.status)) query.status = req.query.status;
    if (!staff && req.query.status === undefined) query.status = { $in: ['OPEN', 'RESOLVED'] };
    const rows = await Complaint.find(query).populate('customer', 'name email').populate('reservation', 'code status total').populate('machine', 'name code').sort({ createdAt: -1 }).limit(100);
    return success(res, rows);
  } catch (error) { return next(error); }
};

exports.resolveComplaint = async (req, res, next) => {
  try {
    if (!isId(req.params.id)) return fail(res, 400, 'INVALID_ID', 'Complaint id is invalid.');
    const response = req.body.response === undefined ? undefined : String(req.body.response).trim();
    if (response !== undefined && response.length > 1000) return fail(res, 400, 'VALIDATION_ERROR', 'Keep your reply under 1000 characters.');
    const complaint = await Complaint.findOneAndUpdate({ _id: req.params.id, status: 'OPEN' }, { $set: { status: 'RESOLVED', resolvedAt: new Date(), resolvedBy: req.user._id, ...(response ? { response } : {}) } }, { new: true }).populate('customer', 'name email').populate('reservation', 'code status total');
    if (complaint) await recordAdminAudit(req, {
      action: 'Resolved support complaint',
      targetType: 'Complaint',
      targetId: complaint._id,
      targetLabel: `${complaint.reference} · ${complaint.subject}`,
      changes: { status: { before: 'OPEN', after: 'RESOLVED' }, replied: Boolean(response) },
    });
    return complaint ? success(res, complaint) : fail(res, 404, 'NOT_FOUND', 'An open complaint with that id was not found.');
  } catch (error) { return next(error); }
};

exports.overview = async (req, res, next) => {
  try {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    await releaseExpiredReservations();
    await syncOperationalAlerts();
    // Vendors only see the machines assigned to their account.
    const scoped = req.user.role === 'OPERATOR';
    const machineIds = scoped ? await Machine.find({ vendor: req.user._id }).distinct('_id') : null;
    const machineFilter = scoped ? { vendor: req.user._id } : {};
    const stockFilter = scoped ? { machine: { $in: machineIds } } : {};
    const orderFilter = scoped ? { machine: { $in: machineIds } } : {};
    const [machines, online, inventory, alerts, sales, revenue, recentOrders, demand, salesTrend, topProducts] = await Promise.all([
      Machine.countDocuments(machineFilter),
      Machine.countDocuments({ ...machineFilter, status: 'ONLINE' }),
      Inventory.find(stockFilter).populate('machine', 'name code status').populate('product', 'name sku price category'),
      Alert.find({ resolvedAt: null, ...stockFilter }).populate('machine', 'name code').populate('product', 'name sku').sort({ createdAt: -1 }).limit(20),
      Reservation.countDocuments({ status: 'DISPENSED', createdAt: { $gte: since }, ...orderFilter }),
      Reservation.aggregate([{ $match: { status: 'DISPENSED', createdAt: { $gte: since }, ...orderFilter } }, { $group: { _id: null, total: { $sum: '$total' } } }]),
      Reservation.find(orderFilter).populate('machine', 'name code').sort({ createdAt: -1 }).limit(6).select('code total status createdAt machine'),
      Reservation.aggregate([{ $match: { status: 'DISPENSED', createdAt: { $gte: since }, ...orderFilter } }, { $unwind: '$items' }, { $group: { _id: { product: '$items.product', machine: '$machine', name: '$items.name' }, units: { $sum: '$items.quantity' }, orders: { $sum: 1 } } }]),
      Reservation.aggregate([{ $match: { status: 'DISPENSED', createdAt: { $gte: since }, ...orderFilter } }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, sales: { $sum: 1 }, revenue: { $sum: '$total' } } }, { $sort: { _id: 1 } }]),
      Reservation.aggregate([{ $match: { status: 'DISPENSED', createdAt: { $gte: since }, ...orderFilter } }, { $unwind: '$items' }, { $group: { _id: '$items.name', units: { $sum: '$items.quantity' }, revenue: { $sum: { $multiply: ['$items.quantity', '$items.unitPrice'] } } } }, { $sort: { units: -1, revenue: -1, _id: 1 } }, { $limit: 5 }]),
    ]);
    let machineAttendance = await exports.listMachineAttendanceWithVendor(req);
    const recommendations = inventory.map(row => {
      const sold = demand.filter(entry => String(entry._id.product) === String(row.product?._id) && String(entry._id.machine) === String(row.machine?._id)).reduce((sum, entry) => sum + entry.units, 0);
      const available = row.available;
      return { inventoryId: row._id, machine: row.machine, product: row.product, threshold: row.lowStockThreshold, unitsSold30d: sold, ...projectStock({ available, reserved: row.reserved, lowStockThreshold: row.lowStockThreshold, unitsSold: sold, days: 30 }) };
    }).filter(row => row.available <= row.threshold || (row.daysRemaining !== null && row.daysRemaining <= 3)).sort((a, b) => (a.daysRemaining ?? 999) - (b.daysRemaining ?? 999));
    return success(res, { machines: { total: machines, online }, inventory: { rows: inventory.length, lowStock: inventory.filter(row => row.available <= row.lowStockThreshold).length }, alerts, sales30d: sales, revenue30d: Math.round((revenue[0]?.total || 0) * 100) / 100, recentOrders, salesTrend: salesTrend.map(row => ({ date: row._id, sales: row.sales, revenue: Math.round(row.revenue * 100) / 100 })), topProducts: topProducts.map(row => ({ name: row._id, units: row.units, revenue: Math.round(row.revenue * 100) / 100 })), recommendations, machineAttendance });
  } catch (error) { return next(error); }
};

exports.resolveAlert = async (req, res, next) => {
  try {
    if (!isId(req.params.id)) return fail(res, 400, 'INVALID_ID', 'Alert id is invalid.');
    const alert = await Alert.findOneAndUpdate({ _id: req.params.id, resolvedAt: null }, { $set: { resolvedAt: new Date(), suppressed: true } }, { new: true });
    if (alert) await recordAdminAudit(req, {
      action: 'Resolved stock alert',
      targetType: 'Alert',
      targetId: alert._id,
      targetLabel: alert.message,
      changes: { resolved: { before: false, after: true } },
    });
    return alert ? success(res, alert) : fail(res, 404, 'NOT_FOUND', 'Open alert not found.');
  } catch (error) { return next(error); }
};

exports.listMachineAttendanceWithVendor = async (req, res, next) => {
  try {
    const rows = await Machine.find(req.user.role === 'OPERATOR' ? { vendor: req.user._id } : {}, 'name code status capacity vendor').populate('vendor', 'name').sort({ name: 1 });
    const now = new Date();
    const dailySnap = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const since24h = new Date(dailySnap.getTime() - 24 * 60 * 60 * 1000);
    const machineIds = rows.map(row => row._id);
    const dispensedCountMap = new Map();
    const revenueMap = new Map();
    if (machineIds.length) {
      const dispensedCounts = await Reservation.aggregate([
        { $match: { machine: { $in: machineIds }, status: 'DISPENSED', createdAt: { $gte: since24h } } },
        { $group: { _id: '$machine', count: { $sum: 1 } } },
      ]);
      for (const row of dispensedCounts) dispensedCountMap.set(String(row._id), row.count);
      const revenueRows = await Reservation.aggregate([
        { $match: { machine: { $in: machineIds }, status: 'DISPENSED', createdAt: { $gte: since24h } } },
        { $group: { _id: '$machine', total: { $sum: '$total' } } },
      ]);
      for (const row of revenueRows) revenueMap.set(String(row._id), Math.round((row.total || 0) * 100) / 100);
    }
    return rows.map(row => ({
      _id: row._id,
      name: row.name,
      code: row.code,
      address: row.address,
      status: row.status,
      capacity: row.capacity || 0,
      vendor: row.vendor || null,
      onlineOrdersToday: dispensedCountMap.get(String(row._id)) || 0,
      revenueToday: revenueMap.get(String(row._id)) || 0,
      utilization: row.capacity ? Math.round((dispensedCountMap.get(String(row._id)) || 0) / row.capacity * 100) : 0,
    }));
  } catch (error) { return next ? next(error) : Promise.reject(error); }
};

exports.forecast = async (req, res, next) => {
  try {
    const requestedDays = Number(req.query.days);
    if (req.query.days !== undefined && (!Number.isInteger(requestedDays) || requestedDays < 7 || requestedDays > 90)) return fail(res, 400, 'VALIDATION_ERROR', 'Forecast days must be a whole number between 7 and 90.');
    const days = requestedDays || 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const scoped = req.user.role === 'OPERATOR';
    const machineIds = scoped ? await Machine.find({ vendor: req.user._id }).distinct('_id') : null;
    const rows = await Inventory.find(scoped ? { machine: { $in: machineIds } } : {}).populate('machine', 'name code status').populate('product', 'name sku category price');
    const sold = await Reservation.aggregate([{ $match: { status: 'DISPENSED', createdAt: { $gte: since }, ...(scoped ? { machine: { $in: machineIds } } : {}) } }, { $unwind: '$items' }, { $group: { _id: { machine: '$machine', product: '$items.product' }, units: { $sum: '$items.quantity' } } }]);
    const byKey = new Map(sold.map(row => [`${row._id.machine}:${row._id.product}`, row.units]));
    return success(res, rows.map(row => {
      const units = byKey.get(`${row.machine._id}:${row.product._id}`) || 0;
      const available = row.available;
      return { inventoryId: row._id, machine: row.machine, product: row.product, periodDays: days, unitsSold: units, ...projectStock({ available, reserved: row.reserved, lowStockThreshold: row.lowStockThreshold, unitsSold: units, days }) };
    }).sort((a, b) => (a.daysRemaining ?? 9999) - (b.daysRemaining ?? 9999)));
  } catch (error) { return next(error); }
};
