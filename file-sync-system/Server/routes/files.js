// routes/files.js
const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const authMiddleware = require('../middleware/auth');
const pool = require('../config/database');
const { minioClient, BUCKET_NAME } = require('../config/minio');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB
  },
});

function calculateFileHash(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function generatePresignedUrl(minioKey, expirySeconds = 3600) {
  // Generate presigned URL for temporary access (default 1 hour)
  try {
    const presignedUrl = await minioClient.presignedGetObject(BUCKET_NAME, minioKey, expirySeconds);
    return presignedUrl;
  } catch (error) {
    console.error('Error generating presigned URL:', error);
    throw new Error('Failed to generate download URL');
  }
}

// Generate permanent MinIO key (stored in database)
function generatePermanentMinioKey(userId, filename) {
  const fileId = uuidv4();
  return `users/${userId}/files/${fileId}/${filename}`;
}

// Upload file
router.post('/upload', authMiddleware, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    const { originalname, buffer, mimetype, size } = req.file;
    const { filePath = '/', localUrl } = req.body;
    
    const fileHash = calculateFileHash(buffer);
    const fullPath = path.join(filePath, originalname).replace(/\\/g, '/');
    
    // Check for duplicate file by hash (allow updates)
    const existingFile = await pool.query(
      'SELECT * FROM files WHERE user_id = $1 AND file_hash = $2 AND status = $3',
      [req.user.id, fileHash, 'active']
    );
    
    let fileRecord;
    
    if (existingFile.rows.length > 0) {
      // File with same content already exists
      fileRecord = existingFile.rows[0];
      
      // Update local_url if provided
      if (localUrl && fileRecord.local_url !== localUrl) {
        await pool.query(
          'UPDATE files SET local_url = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
          [localUrl, fileRecord.id]
        );
        fileRecord.local_url = localUrl;
      }
      
      res.json({
        message: 'File already exists with identical content',
        file: {
          id: fileRecord.id,
          filename: fileRecord.filename,
          filePath: fileRecord.file_path,
          fileSize: fileRecord.file_size,
          fileHash: fileRecord.file_hash,
          mimeType: fileRecord.mime_type,
          localUrl: fileRecord.local_url,
          s3Url: await generatePresignedUrl(fileRecord.minio_key),
          createdAt: fileRecord.created_at
        }
      });
      return;
    }
    
    const minioKey = generatePermanentMinioKey(req.user.id, originalname);
    
    // Upload to MinIO
    await minioClient.putObject(BUCKET_NAME, minioKey, buffer, {
      'Content-Type': mimetype,
      'X-File-Hash': fileHash,
    });
    
    // Save to database (store minioKey, not presigned URL)
    const result = await pool.query(`
      INSERT INTO files (user_id, filename, file_path, file_size, file_hash, mime_type, minio_key, local_url, upload_status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, [req.user.id, originalname, fullPath, size, fileHash, mimetype, minioKey, localUrl, 'completed']);
    
    fileRecord = result.rows[0];
    
    res.status(201).json({
      message: 'File uploaded successfully',
      file: {
        id: fileRecord.id,
        filename: fileRecord.filename,
        filePath: fileRecord.file_path,
        fileSize: fileRecord.file_size,
        fileHash: fileRecord.file_hash,
        mimeType: fileRecord.mime_type,
        localUrl: fileRecord.local_url,
        s3Url: await generatePresignedUrl(fileRecord.minio_key),
        createdAt: fileRecord.created_at
      }
    });
  } catch (error) {
    next(error);
  }
});

// Get download URL
router.get('/:fileId/download', authMiddleware, async (req, res, next) => {
  try {
    const { fileId } = req.params;
    
    const result = await pool.query(
      'SELECT * FROM files WHERE id = $1 AND user_id = $2 AND status = $3',
      [fileId, req.user.id, 'active']
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    const file = result.rows[0];
    
    const downloadUrl = await minioClient.presignedGetObject(
      BUCKET_NAME,
      file.minio_key,
      24 * 60 * 60
    );
    
    res.json({
      file: {
        id: file.id,
        filename: file.filename,
        filePath: file.file_path,
        fileSize: file.file_size,
        mimeType: file.mime_type
      },
      downloadUrl
    });
  } catch (error) {
    next(error);
  }
});

// List files
router.get('/', authMiddleware, async (req, res, next) => {
  try {
    const { path: filePath = '/', limit = 50, offset = 0 } = req.query;
    
    let query = `
      SELECT id, filename, file_path, file_size, file_hash, mime_type, created_at, updated_at
      FROM files 
      WHERE user_id = $1 AND status = $2
    `;
    const params = [req.user.id, 'active'];
    
    if (filePath !== '/') {
      query += ' AND file_path LIKE $3';
      params.push(`${filePath}%`);
    }
    
    query += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
    params.push(parseInt(limit), parseInt(offset));
    
    const result = await pool.query(query, params);
    
    res.json({
      files: result.rows,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        total: result.rows.length
      }
    });
  } catch (error) {
    next(error);
  }
});

// Get fresh presigned URL for a file
router.get('/:fileId/url', authMiddleware, async (req, res, next) => {
  try {
    const { fileId } = req.params;
    const { expiryHours = 24 } = req.query; // Default 24 hours
    
    const result = await pool.query(
      'SELECT minio_key, filename FROM files WHERE id = $1 AND user_id = $2 AND status = $3',
      [fileId, req.user.id, 'active']
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    const file = result.rows[0];
    const expirySeconds = parseInt(expiryHours) * 3600;
    const presignedUrl = await generatePresignedUrl(file.minio_key, expirySeconds);
    
    res.json({
      filename: file.filename,
      url: presignedUrl,
      expiresIn: expirySeconds,
      expiresAt: new Date(Date.now() + expirySeconds * 1000).toISOString()
    });
  } catch (error) {
    next(error);
  }
});

// Delete file
router.delete('/:fileId', authMiddleware, async (req, res, next) => {
  try {
    const { fileId } = req.params;
    
    const result = await pool.query(
      'SELECT * FROM files WHERE id = $1 AND user_id = $2 AND status = $3',
      [fileId, req.user.id, 'active']
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    const file = result.rows[0];
    
    // Delete from MinIO
    await minioClient.removeObject(BUCKET_NAME, file.minio_key);
    
    // Mark as deleted
    await pool.query(
      'UPDATE files SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      ['deleted', fileId]
    );
    
    res.json({ message: 'File deleted successfully' });
  } catch (error) {
    next(error);
  }
});

// Delete file by hash (for propagating deletions across devices)
router.delete('/hash/:fileHash', authMiddleware, async (req, res, next) => {
  try {
    const { fileHash } = req.params;
    
    // Find file by hash
    const result = await pool.query(
      'SELECT * FROM files WHERE user_id = $1 AND file_hash = $2 AND status = $3',
      [req.user.id, fileHash, 'active']
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    const file = result.rows[0];
    
    try {
      // Delete from MinIO
      await minioClient.removeObject(BUCKET_NAME, file.minio_key);
      console.log(`🗑️ Deleted from MinIO: ${file.minio_key}`);
    } catch (minioError) {
      console.error('MinIO deletion error:', minioError);
      // Continue with database deletion even if MinIO fails
    }
    
    // Mark as deleted in database
    await pool.query(
      'UPDATE files SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      ['deleted', file.id]
    );
    
    res.json({
      message: 'File deleted successfully',
      file: {
        id: file.id,
        filename: file.filename,
        fileHash: file.file_hash
      }
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;