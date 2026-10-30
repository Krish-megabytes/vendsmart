const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { rateLimit } = require('./middleware/rateLimit');

const app = express();

// Security and utility middleware
app.use(helmet());
const allowedClientOrigins = new Set([process.env.CLIENT_URL || 'http://localhost:5173']);
const isLocalDevOrigin = (origin) => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin || '');
app.use(cors({
  origin: (origin, callback) => {
    // Vite picks the next free port when 5173 is taken, so accept any loopback
    // origin while developing; production still requires an exact CLIENT_URL match.
    const allowed = !origin || allowedClientOrigins.has(origin) || (process.env.NODE_ENV !== 'production' && isLocalDevOrigin(origin));
    callback(null, allowed);
  },
  credentials: true,
}));
app.use(express.json({ limit: '32kb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

// Health check route
app.get('/health', (req, res) => {
  res.status(200).json({ success: true, message: 'VendSmart API is running' });
});

// Routes
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: 'Too many sign-in requests. Please wait and try again.' }), require('./routes/authRoutes'));
app.use('/api/users', require('./routes/adminRoutes'));
app.use('/api', require('./routes/vendingRoutes'));

// Central error handler
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err.code === 11000) return res.status(409).json({ success: false, error: { code: 'DUPLICATE_RECORD', message: 'A record with that unique value already exists.' } });
  if (err.name === 'ValidationError' || err.name === 'CastError') return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'The submitted data is invalid.' } });
  if (!['ValidationError', 'CastError'].includes(err.name) && err.code !== 11000) console.error(err.message);
  res.status(err.status || 500).json({
    success: false,
    error: {
      code: err.code || 'INTERNAL_SERVER_ERROR',
      message: err.message || 'An unexpected error occurred.'
    }
  });
});

module.exports = app;
