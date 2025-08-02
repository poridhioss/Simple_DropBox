// client/lib/sync.js - Merkle Tree version
const api = require('./api');
const config = require('../config');
const path = require('path');
const fs = require('fs-extra');
const crypto = require('crypto');
const { MerkleTree } = require('./merkle-tree');

let lastSyncAt = null;

function calculateFileHash(filePath) {
  try {
    const buffer = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(buffer).digest('hex');
  } catch (error) {
    return null;
  }
}

async function performSync() {
  try {
    console.log('🔄 Starting Merkle Tree sync...');
    
    const fileWatcher = require('./file-watcher');
    const localTree = fileWatcher.getMerkleTree();
    
    // Get differences between local and server trees
    const result = await api.getMerkleTreeDifferences(config.DEVICE_ID, localTree.toJSON());
    
    if (!result || !result.differences) {
      console.log('⚠️ No differences data received from server');
      return;
    }
    
    const differences = result.differences;
    
    if ((differences.added && differences.added.length > 0) || 
        (differences.modified && differences.modified.length > 0) || 
        (differences.deleted && differences.deleted.length > 0)) {
      
      console.log(`📊 Sync differences found:`);
      console.log(`  Added: ${differences.added ? differences.added.length : 0}`);
      console.log(`  Modified: ${differences.modified ? differences.modified.length : 0}`);
      console.log(`  Deleted: ${differences.deleted ? differences.deleted.length : 0}`);
      
      // Download added/modified files from server
      const filesToDownload = [
        ...(differences.added || []), 
        ...(differences.modified || [])
      ];
      
      // Only download files that have valid s3_url (fully uploaded)
      for (const file of filesToDownload) {
        if (file.s3_url && file.id) {
          await downloadFileFromServer(file);
        } else {
          console.log(`⏭️ Skipping download of ${file.filename} (no S3 URL or ID)`);
        }
      }
      
      // Handle deleted files (propagate server deletions to local)
      if (differences.deleted && differences.deleted.length > 0) {
        console.log(`🗑️ Processing ${differences.deleted.length} deleted files from server...`);
        for (const file of differences.deleted) {
          await handleServerDeletion(file);
        }
      }
      
      // Update local tree and save
      await fileWatcher.saveMerkleTree();
      
    } else {
      console.log('✅ No sync differences found');
    }
    
    // Update last sync time
    lastSyncAt = new Date().toISOString();
    
    console.log('✅ Merkle Tree sync completed');
    
  } catch (error) {
    console.error('❌ Sync failed:', error.message);
    console.error('Full error:', error);
  }
}

async function downloadFileFromServer(fileMetadata) {
  const fileWatcher = require('./file-watcher'); // Import here to avoid circular dependency
  
  try {
    const localPath = path.join(config.WATCH_DIRECTORY, fileMetadata.file_path);
    const relativePath = path.relative(config.WATCH_DIRECTORY, localPath);
    
    // Check if file already exists and compare hash
    if (await fs.pathExists(localPath)) {
      const localHash = calculateFileHash(localPath);
      if (localHash === fileMetadata.hash) {
        console.log(`⏭️ File unchanged: ${fileMetadata.filename}`);
        return;
      }
    }
    
    // Mark file as being downloaded to prevent upload trigger
    fileWatcher.markAsDownloading(relativePath);
    
    console.log(`📥 Downloading: ${fileMetadata.filename}`);
    
    // Use authenticated server download instead of direct S3 access
    // This ensures fresh URLs and proper authentication
    if (fileMetadata.id) {
      await api.downloadFile(fileMetadata.id, localPath);
    } else {
      console.error(`❌ No file ID available for ${fileMetadata.filename}`);
      return;
    }
    
    // Update local Merkle Tree
    const localTree = fileWatcher.getMerkleTree();
    localTree.addOrUpdateFile(relativePath, {
      filename: fileMetadata.filename,
      local_url: localPath,
      s3_url: fileMetadata.s3_url,
      hash: fileMetadata.hash,
      size: fileMetadata.size,
      mime_type: fileMetadata.mime_type
    });
    
    // Mark download complete with hash
    fileWatcher.markDownloadComplete(relativePath, fileMetadata.hash);
    
  } catch (error) {
    console.error(`❌ Failed to download ${fileMetadata.filename}:`, error.message);
    
    // Clean up on error
    const relativePath = path.relative(config.WATCH_DIRECTORY, 
      path.join(config.WATCH_DIRECTORY, fileMetadata.file_path));
    require('./file-watcher').markDownloadComplete(relativePath, null);
  }
}

async function downloadFromS3Url(s3Url, localPath) {
  const axios = require('axios');
  
  try {
    const response = await axios.get(s3Url, {
      responseType: 'stream'
    });

    // Ensure directory exists
    const dir = path.dirname(localPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Save file
    const writeStream = fs.createWriteStream(localPath);
    response.data.pipe(writeStream);

    return new Promise((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });
  } catch (error) {
    console.error('❌ S3 download failed:', error.message);
    throw error;
  }
}

async function handleServerDeletion(fileMetadata) {
  try {
    const localPath = path.join(config.WATCH_DIRECTORY, fileMetadata.file_path);
    const relativePath = path.relative(config.WATCH_DIRECTORY, localPath);
    
    console.log(`🗑️ Server deleted file, removing locally: ${fileMetadata.filename}`);
    
    // Remove local file if it exists
    if (await fs.pathExists(localPath)) {
      await fs.remove(localPath);
      console.log(`🗑️ Deleted local file: ${fileMetadata.filename}`);
    }
    
    // Remove from local Merkle Tree
    const fileWatcher = require('./file-watcher');
    const localTree = fileWatcher.getMerkleTree();
    localTree.removeFile(relativePath);
    
    console.log(`🌳 Removed from local Merkle Tree: ${fileMetadata.filename}`);
    
  } catch (error) {
    console.error(`❌ Failed to handle server deletion ${fileMetadata.filename}:`, error.message);
  }
}

function startPeriodicSync() {
  // Initial sync
  performSync();
  
  // Set up periodic sync
  setInterval(performSync, config.SYNC_INTERVAL);
  
  console.log(`⏰ Periodic sync every ${config.SYNC_INTERVAL / 1000} seconds`);
}

module.exports = {
  performSync,
  startPeriodicSync
};
