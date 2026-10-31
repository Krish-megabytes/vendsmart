const test = require('node:test');
const assert = require('node:assert/strict');
const AdminAuditLog = require('../models/AdminAuditLog');
const { recordAdminAudit } = require('./adminAudit');

test('records administrator identity, target, and changes', async () => {
  const originalCreate = AdminAuditLog.create;
  let record;
  AdminAuditLog.create = async value => { record = value; return value; };
  try {
    await recordAdminAudit({
      user: { _id: 'admin-id', name: 'Admin User', email: 'admin@example.test', role: 'ADMIN' },
    }, {
      action: 'Banned account',
      targetType: 'Account',
      targetId: 'target-id',
      targetLabel: 'Customer (customer@example.test)',
      changes: { banned: { before: false, after: true } },
    });
    assert.equal(record.actor, 'admin-id');
    assert.equal(record.actorEmail, 'admin@example.test');
    assert.equal(record.targetId, 'target-id');
    assert.deepEqual(record.changes.banned, { before: false, after: true });
  } finally {
    AdminAuditLog.create = originalCreate;
  }
});

test('does not create administrator audit records for operator actions', async () => {
  const originalCreate = AdminAuditLog.create;
  let called = false;
  AdminAuditLog.create = async () => { called = true; };
  try {
    await recordAdminAudit({ user: { role: 'OPERATOR' } }, {
      action: 'Updated inventory',
      targetType: 'Inventory',
      targetId: 'inventory-id',
      targetLabel: 'Stock row',
    });
    assert.equal(called, false);
  } finally {
    AdminAuditLog.create = originalCreate;
  }
});
