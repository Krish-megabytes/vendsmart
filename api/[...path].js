if (!process.env.NODE_ENV) process.env.NODE_ENV = 'production';

const app = require('../server/src/app');
const connectDB = require('../server/src/config/db');

let connectionPromise;

module.exports = async (req, res) => {
  if (!connectionPromise) {
    connectionPromise = connectDB().catch((error) => {
      connectionPromise = null;
      throw error;
    });
  }

  await connectionPromise;
  return app(req, res);
};
