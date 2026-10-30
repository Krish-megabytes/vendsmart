const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  phone: {
    type: String,
    trim: true,
  },
  passwordHash: {
    type: String,
    required: true,
  },
  role: {
    type: String,
    enum: ['CUSTOMER', 'OPERATOR', 'ADMIN'],
    default: 'CUSTOMER',
  },
  banned: {
    type: Boolean,
    default: false,
    index: true,
  },
  bannedAt: Date,
  preferences: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
    default: {},
  },
  favorites: {
    type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
    default: [],
  },
}, {
  timestamps: true,
});

// Method to match entered password with hashed password in database
userSchema.methods.matchPassword = async function(enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.passwordHash);
};

// Pre-save middleware to hash password if it's modified (e.g., created or reset)
// Note: Usually we pass plaintext password to this model and let it hash, 
// but since we named the field 'passwordHash', we'll assume the controller 
// might hash it before saving, or we can use a virtual 'password' field.
userSchema.virtual('password').set(function(password) {
  this._password = password;
});

userSchema.pre('validate', async function() {
  if (this._password) {
    const salt = await bcrypt.genSalt(10);
    this.passwordHash = await bcrypt.hash(this._password, salt);
  }
});

const User = mongoose.model('User', userSchema);
module.exports = User;
