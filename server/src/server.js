require('dotenv').config();

const http = require('http');
const app = require('./app');
const connectDB = require('./config/db');
const mongoose = require('mongoose');

const PORT = Number(process.env.PORT) > 0 ? Number(process.env.PORT) : 5000;
const server = http.createServer(app);

let shuttingDown = false;

const startServer = async () => {
  if (shuttingDown) return;
  try {
    await connectDB();
    console.log('MongoDB connected successfully.');

    server.listen(PORT, () => {
      console.log(`Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error.message);
    process.exitCode = 1;
  }
};

const cleanup = async (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${signal} received. Shutting down gracefully…`);

  server.close((closeError) => {
    if (closeError) console.error('Server close error:', closeError.message);
    else console.log('HTTP server closed.');
  });

  setTimeout(() => {
    console.log('Forcing shutdown after timeout.');
    mongoose.connection.close(false).catch(() => {});
    process.exit(1);
  }, 8000).unref();

  try {
    await Promise.race([
      new Promise((resolve) => server.on('close', resolve)),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Server close timed out.')), 7500))
    ]);
  } catch (err) {
    console.error('Server close timed out.');
  }

  try {
    await mongoose.connection.close(false);
    console.log('MongoDB connection closed.');
  } catch (dbError) {
    console.error('MongoDB close error:', dbError.message);
  }

  process.exit(0);
};

process.on('SIGINT', () => void cleanup('SIGINT'));
process.on('SIGTERM', () => void cleanup('SIGTERM'));

startServer();
