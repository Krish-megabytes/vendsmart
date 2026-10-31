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

  const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const apiPath = requestUrl.searchParams.get('_api_path');
  const segments = apiPath?.split('/');
  if (!segments?.length || segments.some((segment) => !segment || segment === '.' || segment === '..' || segment.includes('\\'))) {
    return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'API route not found.' } });
  }

  requestUrl.searchParams.delete('_api_path');
  const query = requestUrl.searchParams.toString();
  req.url = `/api/${segments.join('/')}${query ? `?${query}` : ''}`;

  return app(req, res);
};
