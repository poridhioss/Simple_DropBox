// routes/merkle.js
const express = require('express');
const Joi = require('joi');
const authMiddleware = require('../middleware/auth');
const pool = require('../config/database');
const { minioClient, BUCKET_NAME } = require('../config/minio');

const router = express.Router();

// Generate presigned URL for file access
async function generatePresignedUrl(minioKey, expirySeconds = 3600) {
  try {
    const presignedUrl = await minioClient.presignedGetObject(BUCKET_NAME, minioKey, expirySeconds);
    return presignedUrl;
  } catch (error) {
    console.error('Error generating presigned URL:', error);
    return null;
  }
}

// Simple Merkle Tree implementation for server
class MerkleTree {
  constructor() {
    this.files = new Map();
  }

  fromJSON(data) {
    this.files.clear();
    if (data.files) {
      for (const file of data.files) {
        this.files.set(file.file_path, file);
      }
    }
  }

  getAllFiles() {
    return Array.from(this.files.values());
  }

  getDifferences(otherTree) {
    const myFiles = new Map(this.files);
    const otherFiles = new Map();
    
    for (const file of otherTree.getAllFiles()) {
      otherFiles.set(file.file_path, file);
    }
    
    const differences = {
      added: [],
      modified: [],
      deleted: []
    };
    
    // Find added and modified files (from server perspective)
    for (const [filePath, file] of myFiles) {
      if (!otherFiles.has(filePath)) {
        differences.added.push(file);
      } else {
        const otherFile = otherFiles.get(filePath);
        if (file.hash !== otherFile.hash || file.timestamp !== otherFile.timestamp) {
          differences.modified.push(file);
        }
      }
    }
    
    // Find deleted files (files in other tree but not in server tree)
    for (const [filePath, file] of otherFiles) {
      if (!myFiles.has(filePath)) {
        differences.deleted.push(file);
      }
    }
    
    return differences;
  }
}

// Enrich file metadata with fresh presigned URLs
async function enrichFilesWithFreshUrls(files, userId) {
  const enrichedFiles = [];
  
  for (const file of files) {
    try {
      // Get minio_key from database
      const dbResult = await pool.query(
        'SELECT minio_key, id FROM files WHERE user_id = $1 AND file_hash = $2 AND status = $3 ORDER BY created_at DESC LIMIT 1',
        [userId, file.hash, 'active']
      );
      
      if (dbResult.rows.length > 0) {
        const dbFile = dbResult.rows[0];
        const freshUrl = await generatePresignedUrl(dbFile.minio_key, 24 * 3600); // 24 hours
        
        enrichedFiles.push({
          ...file,
          id: dbFile.id,
          s3_url: freshUrl || file.s3_url // Fallback to old URL if generation fails
        });
      } else {
        // File not found in database, return as-is
        enrichedFiles.push(file);
      }
    } catch (error) {
      console.error(`Error enriching file ${file.filename}:`, error);
      enrichedFiles.push(file); // Return original if enrichment fails
    }
  }
  
  return enrichedFiles;
}

const updateTreeSchema = Joi.object({
  deviceId: Joi.string().required(),
  treeData: Joi.object({
    rootHash: Joi.string().allow(null),
    timestamp: Joi.string().isoDate(),
    files: Joi.array().items(Joi.object({
      filename: Joi.string().required(),
      file_path: Joi.string().required(),
      local_url: Joi.string().allow(null),
      s3_url: Joi.string().allow(null),
      hash: Joi.string().required(),
      size: Joi.number().required(),
      timestamp: Joi.string().isoDate(),
      mime_type: Joi.string().allow(null)
    }))
  }).required()
});

const diffSchema = Joi.object({
  deviceId: Joi.string().required(),
  localTreeData: Joi.object().required()
});

// Update Merkle Tree on server
router.post('/update', authMiddleware, async (req, res, next) => {
  try {
    const { error, value } = updateTreeSchema.validate(req.body);
    if (error) throw error;
    
    const { deviceId, treeData } = value;
    
    // Check for existing tree
    const existingTree = await pool.query(
      'SELECT * FROM merkle_trees WHERE user_id = $1 AND device_id = $2',
      [req.user.id, deviceId]
    );
    
    let result;
    
    if (existingTree.rows.length > 0) {
      // Update existing tree
      result = await pool.query(`
        UPDATE merkle_trees 
        SET root_hash = $3, tree_data = $4, version = version + 1, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = $1 AND device_id = $2
        RETURNING *
      `, [req.user.id, deviceId, treeData.rootHash, JSON.stringify(treeData)]);
    } else {
      // Create new tree
      result = await pool.query(`
        INSERT INTO merkle_trees (user_id, device_id, root_hash, tree_data)
        VALUES ($1, $2, $3, $4)
        RETURNING *
      `, [req.user.id, deviceId, treeData.rootHash, JSON.stringify(treeData)]);
    }
    
    const tree = result.rows[0];
    
    res.json({
      message: 'Merkle tree updated successfully',
      tree: {
        id: tree.id,
        deviceId: tree.device_id,
        rootHash: tree.root_hash,
        version: tree.version,
        updatedAt: tree.updated_at
      }
    });
  } catch (error) {
    next(error);
  }
});

// Get Merkle Tree from server
router.get('/tree', authMiddleware, async (req, res, next) => {
  try {
    const { deviceId } = req.query;
    
    if (!deviceId) {
      return res.status(400).json({ error: 'deviceId is required' });
    }
    
    const result = await pool.query(
      'SELECT * FROM merkle_trees WHERE user_id = $1 AND device_id = $2',
      [req.user.id, deviceId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Merkle tree not found' });
    }
    
    const tree = result.rows[0];
    
    res.json({
      tree: {
        id: tree.id,
        deviceId: tree.device_id,
        rootHash: tree.root_hash,
        treeData: tree.tree_data,
        version: tree.version,
        updatedAt: tree.updated_at
      }
    });
  } catch (error) {
    next(error);
  }
});

// Get differences between local and server trees
router.post('/diff', authMiddleware, async (req, res, next) => {
  try {
    const { error, value } = diffSchema.validate(req.body);
    if (error) throw error;
    
    const { deviceId, localTreeData } = value;
    
    // Get server tree
    const serverResult = await pool.query(
      'SELECT * FROM merkle_trees WHERE user_id = $1 AND device_id = $2',
      [req.user.id, deviceId]
    );
    
    let differences = {
      added: [],
      modified: [],
      deleted: []
    };
    
    if (serverResult.rows.length > 0) {
      // Server tree exists - compare with local tree
      const serverTree = new MerkleTree();
      serverTree.fromJSON(serverResult.rows[0].tree_data);
      
      const localTree = new MerkleTree();
      localTree.fromJSON(localTreeData);
      
      // Calculate differences (server perspective - what server has that local doesn't)
      differences = serverTree.getDifferences(localTree);
    } else {
      // No server tree exists yet - all local files are "new" from server perspective
      console.log('No server tree found for device:', deviceId);
      // Return empty differences since there's nothing on server to sync down
      differences = {
        added: [],
        modified: [],
        deleted: []
      };
    }

    // Enrich differences with fresh presigned URLs
    const enrichedDifferences = {
      added: await enrichFilesWithFreshUrls(differences.added, req.user.id),
      modified: await enrichFilesWithFreshUrls(differences.modified, req.user.id),
      deleted: differences.deleted // No URLs needed for deleted files
    };
    
    res.json({
      differences: enrichedDifferences,
      serverRootHash: serverResult.rows.length > 0 ? serverResult.rows[0].root_hash : null,
      localRootHash: localTreeData.rootHash || null
    });
  } catch (error) {
    console.error('Error in /diff endpoint:', error);
    next(error);
  }
});

// List all devices and their trees for a user
router.get('/devices', authMiddleware, async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT device_id, root_hash, version, updated_at FROM merkle_trees WHERE user_id = $1 ORDER BY updated_at DESC',
      [req.user.id]
    );
    
    res.json({
      devices: result.rows.map(row => ({
        deviceId: row.device_id,
        rootHash: row.root_hash,
        version: row.version,
        lastUpdated: row.updated_at
      }))
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
