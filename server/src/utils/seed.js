require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Machine = require('../models/Machine');
const Product = require('../models/Product');
const Inventory = require('../models/Inventory');

const CAMPUS_ADDRESS = 'Chandigarh University, Gharuan, Mohali, Punjab 140413';

// Every machine is a vendor location on the Chandigarh University campus, so the
// map, distance sorting and pickup guides all work block by block.
const machines = [
  { name: 'Block A — Academic', code: 'VS-CU-001', description: 'Lecture-hall floor vending beside the main staircase.', address: `Block A, ${CAMPUS_ADDRESS}`, latitude: 30.7695, longitude: 76.575, capacity: 60 },
  { name: 'Block B — Academic', code: 'VS-CU-002', description: 'Quick snacks between classes.', address: `Block B, ${CAMPUS_ADDRESS}`, latitude: 30.7702, longitude: 76.576, capacity: 48 },
  { name: 'Block C — Academic', code: 'VS-CU-003', description: 'Cold drinks and coffee for the afternoon stretch.', address: `Block C, ${CAMPUS_ADDRESS}`, latitude: 30.769, longitude: 76.5768, capacity: 72 },
  { name: 'Block D — Academic', code: 'VS-CU-004', description: 'Smart vending in the ground-floor lobby.', address: `Block D, ${CAMPUS_ADDRESS}`, latitude: 30.7682, longitude: 76.5757, capacity: 48 },
  { name: 'Block E — Academic', code: 'VS-CU-005', description: 'Late-night study fuel, open around the clock.', address: `Block E, ${CAMPUS_ADDRESS}`, latitude: 30.7676, longitude: 76.5748, capacity: 60 },
  { name: 'Central Library', code: 'VS-CU-006', description: 'Quiet-floor essentials and better-for-you picks.', address: `Central Library, ${CAMPUS_ADDRESS}`, latitude: 30.7708, longitude: 76.5746, capacity: 40 },
  { name: 'Food Court', code: 'VS-CU-007', description: 'The busiest machine on campus at lunch.', address: `Food Court, ${CAMPUS_ADDRESS}`, latitude: 30.7686, longitude: 76.5775, capacity: 84 },
  { name: 'Boys Hostel BH-1', code: 'VS-CU-008', description: 'Hostel lobby vending for late study sessions.', address: `Boys Hostel BH-1, ${CAMPUS_ADDRESS}`, latitude: 30.772, longitude: 76.5778, capacity: 56 },
  { name: 'Girls Hostel GH-1', code: 'VS-CU-009', description: 'Snacks and hydration in the hostel block.', address: `Girls Hostel GH-1, ${CAMPUS_ADDRESS}`, latitude: 30.773, longitude: 76.574, capacity: 56 },
  { name: 'Sports Complex', code: 'VS-CU-010', description: 'Post-workout drinks and protein snacks.', address: `Sports Complex, ${CAMPUS_ADDRESS}`, latitude: 30.7668, longitude: 76.577, capacity: 64 },
];

// Earlier demo data placed three machines in New York. Those records keep their
// ids (and therefore their order history) but are moved onto the campus.
const legacyCodes = ['VS-NYC-001', 'VS-BK-014', 'VS-NYC-027'];

const products = [
  { name: 'Almond Oat Bar', sku: 'SNK-ALM-01', category: 'Snacks', description: 'Roasted almonds, rolled oats and a touch of honey.', price: 2.75, tags: ['vegan', 'protein', 'gluten-free'], image: '🥜' },
  { name: 'Dark Chocolate Bites', sku: 'SNK-CHO-04', category: 'Snacks', description: 'A little 72% cacao pick-me-up.', price: 3.25, tags: ['chocolate', 'vegan'], image: '🍫' },
  { name: 'Sea Salt Popcorn', sku: 'SNK-POP-02', category: 'Snacks', description: 'Lightly salted, air-popped and satisfying.', price: 2.25, tags: ['vegan', 'gluten-free'], image: '🍿' },
  { name: 'Trail Mix', sku: 'SNK-TRM-03', category: 'Snacks', description: 'Cranberries, cashews, almonds and pumpkin seeds.', price: 3.5, tags: ['protein', 'gluten-free'], image: '🥜' },
  { name: 'Sparkling Lime Water', sku: 'DRK-LIM-01', category: 'Drinks', description: 'Crisp bubbles with a squeeze of real lime.', price: 2, tags: ['vegan', 'zero sugar', 'gluten-free'], image: '🍋' },
  { name: 'Cold Brew Coffee', sku: 'DRK-CBR-02', category: 'Drinks', description: 'Slow-steeped, smooth and ready to go.', price: 4.25, tags: ['coffee', 'caffeine'], image: '☕' },
  { name: 'Coconut Water', sku: 'DRK-COC-03', category: 'Drinks', description: 'Naturally refreshing hydration.', price: 3.25, tags: ['vegan', 'gluten-free'], image: '🥥' },
  { name: 'Matcha Energy', sku: 'DRK-MAT-04', category: 'Drinks', description: 'Bright green tea energy, not too sweet.', price: 4.5, tags: ['caffeine', 'vegan'], image: '🍵' },
  { name: 'Protein Crisps', sku: 'FIT-CRP-01', category: 'Better for you', description: 'Crunchy chickpea crisps with sea salt.', price: 3.75, tags: ['protein', 'vegan', 'gluten-free'], image: '✨' },
  { name: 'Berry Yogurt Cup', sku: 'FIT-YGT-02', category: 'Better for you', description: 'Creamy Greek yogurt with real berries.', price: 4, tags: ['protein', 'vegetarian'], image: '🫐' },
  { name: 'Mint Gum', sku: 'ESS-GUM-01', category: 'Essentials', description: 'A fresh little reset for your day.', price: 1.75, tags: ['essentials'], image: '🌿' },
  { name: 'Pocket Hand Sanitizer', sku: 'ESS-SAN-02', category: 'Essentials', description: 'Pocket-sized, aloe-infused clean hands.', price: 2.5, tags: ['essentials'], image: '🫧' },
];

async function seed() {
  if (!process.env.MONGODB_URI) throw new Error('Set MONGODB_URI before seeding.');
  await mongoose.connect(process.env.MONGODB_URI);

  const demoUsers = [
    { name: 'Demo Customer', email: 'customer@vendsmart.demo', password: 'password123', role: 'CUSTOMER' },
    { name: 'Demo Operator', email: 'operator@vendsmart.demo', password: 'password123', role: 'OPERATOR' },
    { name: 'Demo Admin', email: 'admin@vendsmart.demo', password: 'password123', role: 'ADMIN' },
  ];
  for (const data of demoUsers) {
    if (!(await User.exists({ email: data.email }))) await User.create(data);
  }

  // Older demo data used New York locations. Re-point those machines at campus
  // blocks by id so their existing orders keep resolving to a real machine.
  const legacyMachineIds = [];
  for (const code of legacyCodes) {
    const legacy = await Machine.findOne({ code }).select('_id');
    if (legacy) legacyMachineIds.push(legacy._id);
  }

  const machineRows = [];
  for (const [index, data] of machines.entries()) {
    const { latitude, longitude, ...machine } = data;
    const fields = { ...machine, location: { type: 'Point', coordinates: [longitude, latitude] } };
    const relocatedId = legacyMachineIds[index];
    if (relocatedId && !(await Machine.exists({ code: machine.code }))) {
      machineRows.push(await Machine.findByIdAndUpdate(relocatedId, { $set: fields }, { new: true }));
      continue;
    }
    machineRows.push(await Machine.findOneAndUpdate({ code: machine.code }, { $setOnInsert: { ...fields, status: 'ONLINE' } }, { upsert: true, new: true }));
  }

  // The demo operator is a vendor who owns every seeded campus machine.
  const demoVendor = await User.findOne({ email: 'operator@vendsmart.demo' }).select('_id');
  if (demoVendor) await Machine.updateMany({ _id: { $in: machineRows.map(row => row._id) }, vendor: null }, { $set: { vendor: demoVendor._id } });

  const productRows = [];
  for (const data of products) {
    productRows.push(await Product.findOneAndUpdate({ sku: data.sku }, { $setOnInsert: data }, { upsert: true, new: true }));
  }

  for (let machineIndex = 0; machineIndex < machineRows.length; machineIndex += 1) {
    for (let productIndex = 0; productIndex < productRows.length; productIndex += 1) {
      const quantity = 8 + ((machineIndex * 7 + productIndex * 5) % 25);
      await Inventory.updateOne({ machine: machineRows[machineIndex]._id, product: productRows[productIndex]._id }, { $setOnInsert: { quantity, reserved: 0, lowStockThreshold: 5 + (productIndex % 3), slot: `${String.fromCharCode(65 + Math.floor(productIndex / 4))}${(productIndex % 4) + 1}` } }, { upsert: true });
    }
  }

  console.log(`Seeded demo accounts, ${machineRows.length} machines, ${productRows.length} products, and machine inventory. Existing records were preserved.`);
  console.log('Demo logins: customer@vendsmart.demo / operator@vendsmart.demo / admin@vendsmart.demo — password123');
  await mongoose.disconnect();
}

seed().catch(async error => {
  console.error('Seeding error:', error);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
