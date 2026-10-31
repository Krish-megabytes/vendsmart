const Alert = require('../models/Alert');
const Inventory = require('../models/Inventory');
const Machine = require('../models/Machine');
const { availableQuantity, isExpired } = require('./productExpiry');

async function syncOperationalAlerts() {
  const [inventoryRows, machines] = await Promise.all([
    Inventory.find().populate('machine', 'name code status').populate('product', 'name sku'),
    Machine.find().select('name code status'),
  ]);

  const desired = [];
  for (const row of inventoryRows) {
    if (!row.machine || !row.product) continue;
    const available = availableQuantity(row);
    if (available === 0) {
      const message = isExpired(row.expirationDate)
        ? `${row.product.name} has expired and is blocked at ${row.machine.name}.`
        : `${row.product.name} is out of stock at ${row.machine.name}.`;
      desired.push({ type: 'OUT_OF_STOCK', severity: 'CRITICAL', message, machine: row.machine._id, product: row.product._id, inventory: row._id });
    } else if (available <= row.lowStockThreshold) {
      desired.push({ type: 'LOW_STOCK', severity: 'WARNING', message: `${row.product.name} is running low at ${row.machine.name} (${available} left).`, machine: row.machine._id, product: row.product._id, inventory: row._id });
    }
  }
  for (const machine of machines) {
    if (machine.status === 'OFFLINE' || machine.status === 'MAINTENANCE') {
      const offline = machine.status === 'OFFLINE';
      desired.push({ type: offline ? 'MACHINE_OFFLINE' : 'MACHINE_MAINTENANCE', severity: offline ? 'CRITICAL' : 'WARNING', message: `${machine.name} is ${machine.status.toLowerCase().replace('_', ' ')}.`, machine: machine._id });
    }
  }

  const openAlerts = await Alert.find({ resolvedAt: null });
  const desiredKeys = new Set(desired.map(alert => `${alert.type}:${alert.inventory || alert.machine}`));
  const existingKeys = new Set();
  const manuallySuppressed = await Alert.find({ resolvedAt: { $ne: null }, suppressed: true });
  for (const alert of manuallySuppressed) {
    const key = `${alert.type}:${alert.inventory || alert.machine}`;
    if (!desiredKeys.has(key)) await alert.updateOne({ $set: { suppressed: false } });
  }
  for (const alert of openAlerts) {
    const key = `${alert.type}:${alert.inventory || alert.machine}`;
    if (!desiredKeys.has(key)) {
      alert.resolvedAt = new Date();
      alert.suppressed = false;
      await alert.save();
    } else {
      existingKeys.add(key);
    }
  }
  for (const alert of desired) {
    const key = `${alert.type}:${alert.inventory || alert.machine}`;
    if (existingKeys.has(key)) continue;
    const previouslyResolved = await Alert.findOne({ type: alert.type, ...(alert.inventory ? { inventory: alert.inventory } : { machine: alert.machine }) }).sort({ resolvedAt: -1, createdAt: -1 });
    if (previouslyResolved?.resolvedAt && previouslyResolved.suppressed) continue;
    try { await Alert.create(alert); } catch (error) { if (error.code !== 11000) throw error; }
  }
}

module.exports = { syncOperationalAlerts };
