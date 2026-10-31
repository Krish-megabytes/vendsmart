const test = require('node:test');
const assert = require('node:assert/strict');
const User = require('../models/User');
const Machine = require('../models/Machine');
const authController = require('./authController');
const adminController = require('./adminController');
const vendingController = require('./vendingController');

const response = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

test('customer operator request is pending until administrator review', async () => {
  const originalFindById = User.findById;
  const user = {
    _id: 'customer-id',
    role: 'CUSTOMER',
    operatorRequestStatus: 'NONE',
    async save() {},
  };
  User.findById = async () => user;
  try {
    const res = response();
    await authController.requestOperatorAccess({ user: { _id: user._id } }, res, error => { throw error; });
    assert.equal(res.statusCode, 201);
    assert.equal(user.operatorRequestStatus, 'PENDING');

    const repeated = response();
    await authController.requestOperatorAccess({ user: { _id: user._id } }, repeated, error => { throw error; });
    assert.equal(repeated.statusCode, 409);
    assert.equal(repeated.body.error.code, 'REQUEST_PENDING');
  } finally {
    User.findById = originalFindById;
  }
});

test('administrator approval promotes the requester to operator', async () => {
  const originalFindById = User.findById;
  const user = {
    _id: '507f1f77bcf86cd799439011',
    name: 'New Operator',
    email: 'operator@example.test',
    role: 'CUSTOMER',
    banned: false,
    operatorRequestStatus: 'PENDING',
    async save() {},
  };
  User.findById = async () => user;
  try {
    const res = response();
    await adminController.reviewOperatorRequest({
      params: { id: user._id },
      body: { approved: true },
      user: { _id: '507f1f77bcf86cd799439012' },
    }, res, error => { throw error; });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.role, 'OPERATOR');
    assert.equal(res.body.data.operatorRequestStatus, 'APPROVED');
  } finally {
    User.findById = originalFindById;
  }
});

test('operator-created machines are assigned to the creating operator', async () => {
  const originalCreate = Machine.create;
  let created;
  Machine.create = async data => { created = data; return data; };
  try {
    const res = response();
    await vendingController.createMachine({
      user: { _id: 'operator-id', role: 'OPERATOR' },
      body: {
        name: 'Campus North',
        code: 'VS-CAMPUS-01',
        address: 'Campus North',
        latitude: 30.7,
        longitude: 76.5,
      },
    }, res, error => { throw error; });
    assert.equal(res.statusCode, 201);
    assert.equal(created.vendor, 'operator-id');
  } finally {
    Machine.create = originalCreate;
  }
});
