require('dotenv').config();
const path = require('path');

module.exports = {
  API_BASE_URL: process.env.API_BASE_URL || 'http://localhost:3000/api',
  USER_EMAIL: process.env.USER_EMAIL || 'test@example.com',
  USER_PASSWORD: process.env.USER_PASSWORD || 'password123',
  WATCH_DIRECTORY: path.resolve(process.env.WATCH_DIRECTORY || './sync-folder'),
  DEVICE_ID: process.env.DEVICE_ID || 'client-' + Math.random().toString(36).substr(2, 9),
  SYNC_INTERVAL: parseInt(process.env.SYNC_INTERVAL) || 30000
};