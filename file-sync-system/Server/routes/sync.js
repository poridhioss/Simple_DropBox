// routes/sync.js
const express = require('express');
const Joi = require('joi');
const authMiddleware = require('../middleware/auth');
const pool = require('../config/database');

const router = express.Router();

const syncInitSchema = Joi.object({
  deviceId: Joi.string().required(),
  lastSyncAt: Joi.date().iso().allow(null).optional()
});

// Initialize sync
router.post('/init', authMiddleware, async (req, res, next) => {
  try {
    const { error, value } = syncInitSchema.validate(req.body);
    if (error) throw error;
    
    const { deviceId, lastSyncAt } = value;
    
    const syncTime = lastSyncAt ? new Date(lastSyncAt) : new Date('1970-01-01');
    
    // Check for existing session
    const existingSession = await pool.query(
      'SELECT * FROM sync_sessions WHERE user_id = $1 AND device_id = $2',
      [req.user.id, deviceId]
    );
    
    let session;
    
    if (existingSession.rows.length > 0) {
      // Update existing
      const updateResult = await pool.query(`
        UPDATE sync_sessions 
        SET status = 'active', last_sync_at = GREATEST(last_sync_at, $3)
        WHERE user_id = $1 AND device_id = $2
        RETURNING *
      `, [req.user.id, deviceId, syncTime]);
      
      session = updateResult.rows[0];
    } else {
      // Create new
      const insertResult = await pool.query(`
        INSERT INTO sync_sessions (user_id, device_id, status, last_sync_at)
        VALUES ($1, $2, 'active', $3)
        RETURNING *
      `, [req.user.id, deviceId, syncTime]);
      
      session = insertResult.rows[0];
    }
    
    // Get changed files
    const filesResult = await pool.query(`
      SELECT id, filename, file_path, file_size, file_hash, mime_type, created_at, updated_at
      FROM files 
      WHERE user_id = $1 AND status = 'active' AND updated_at > $2
      ORDER BY updated_at DESC
    `, [req.user.id, session.last_sync_at]);
    
    res.json({
      session: {
        id: session.id,
        deviceId: session.device_id,
        lastSyncAt: session.last_sync_at,
        status: session.status
      },
      changedFiles: filesResult.rows,
      serverTime: new Date().toISOString()
    });
  } catch (error) {
    next(error);
  }
});

// Complete sync
router.post('/:sessionId/complete', authMiddleware, async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    
    const result = await pool.query(`
      UPDATE sync_sessions 
      SET status = 'completed', last_sync_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND user_id = $2
      RETURNING *
    `, [sessionId, req.user.id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Sync session not found' });
    }
    
    res.json({
      message: 'Sync completed successfully',
      session: result.rows[0]
    });
  } catch (error) {
    next(error);
  }
});

// Get sync status
router.get('/status', authMiddleware, async (req, res, next) => {
  try {
    const { deviceId } = req.query;
    
    let query = 'SELECT * FROM sync_sessions WHERE user_id = $1';
    const params = [req.user.id];
    
    if (deviceId) {
      query += ' AND device_id = $2';
      params.push(deviceId);
    }
    
    query += ' ORDER BY last_sync_at DESC';
    
    const result = await pool.query(query, params);
    
    res.json({
      sessions: result.rows,
      serverTime: new Date().toISOString()
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;