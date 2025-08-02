const chokidar = require('chokidar');
const path = require('path');
const fs = require('fs-extra');
const crypto = require('crypto');
const api = require('./api');
const config = require('../config');
const { MerkleTree } = require('./merkle-tree');

let watcher = null;
let uploadQueue = new Map();
let isProcessing = false;
let downloadingFiles = new Set();
let recentlyDownloaded = new Map();

// Initialize Merkle Tree
const merkleTree = new MerkleTree();
const merkleTreePath = path.join(config.WATCH_DIRECTORY, '.merkle-tree.json');

// Load existing Merkle Tree
async function loadMerkleTree() {
  try {
    if (await fs.pathExists(merkleTreePath)) {
      const treeData = await fs.readJSON(merkleTreePath);
      merkleTree.fromJSON(treeData);
      console.log('📂 Loaded existing Merkle Tree');
    } else {
      console.log('🌱 Created new Merkle Tree');
    }
  } catch (error) {
    console.error('❌ Error loading Merkle Tree:', error.message);
  }
}

// Save Merkle Tree to disk
async function saveMerkleTree() {
  try {
    await fs.ensureDir(path.dirname(merkleTreePath));
    await fs.writeJSON(merkleTreePath, merkleTree.toJSON(), { spaces: 2 });
  } catch (error) {
    console.error('❌ Error saving Merkle Tree:', error.message);
  }
}

function shouldIgnoreFile(filePath) {
  const basename = path.basename(filePath);
  
  const ignorePatterns = [
    /^\./,          // Hidden files
    /~$/,           // Temp files  
    /\.tmp$/,       // Temp files
    /\.log$/,       // Log files
    /node_modules/, // Dependencies
    /\.git/         // Git files
  ];
  
  return ignorePatterns.some(pattern => pattern.test(basename) || pattern.test(filePath));
}

function calculateFileHash(filePath) {
  try {
    const buffer = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(buffer).digest('hex');
  } catch (error) {
    return null;
  }
}

async function handleFileChange(filePath, eventType) {
  if (shouldIgnoreFile(filePath)) {
    return;
  }
  
  const relativePath = path.relative(config.WATCH_DIRECTORY, filePath);
  
  // Skip if file is currently being downloaded
  if (downloadingFiles.has(relativePath)) {
    console.log(`⏭️ Skipping ${eventType} for ${relativePath} (currently downloading)`);
    return;
  }
  
  // Skip if file was recently downloaded and hasn't actually changed
  if (eventType === 'change' || eventType === 'add') {
    const currentHash = calculateFileHash(filePath);
    const recentDownload = recentlyDownloaded.get(relativePath);
    
    if (recentDownload && currentHash === recentDownload.hash) {
      console.log(`⏭️ Skipping ${eventType} for ${relativePath} (same as downloaded version)`);
      return;
    }
    
    // Update Merkle Tree with new/changed file
    if (currentHash) {
      const stats = await fs.stat(filePath);
      const metadata = {
        file_path: relativePath,
        filename: path.basename(filePath),
        local_url: filePath,
        s3_url: null, // Will be updated after upload
        hash: currentHash,
        size: stats.size,
        timestamp: new Date().toISOString(),
        mime_type: getMimeType(filePath)
      };
      
      merkleTree.addOrUpdateFile(relativePath, metadata);
      await saveMerkleTree();
      console.log(`🌳 Updated Merkle Tree for: ${relativePath}`);
    }
  }
  
  console.log(`📁 File ${eventType}: ${relativePath}`);
  
  if (eventType === 'add' || eventType === 'change') {
    queueUpload(filePath, relativePath);
  } else if (eventType === 'unlink') {
    // Handle local deletion - propagate to server and other devices
    await handleLocalDeletion(relativePath);
  }
}

function queueUpload(filePath, relativePath) {
  uploadQueue.set(relativePath, {
    fullPath: filePath,
    relativePath: relativePath,
    timestamp: Date.now(),
    hash: calculateFileHash(filePath)
  });
  
  setTimeout(processUploadQueue, 1000);
}

async function processUploadQueue() {
  if (isProcessing || uploadQueue.size === 0) {
    return;
  }
  
  isProcessing = true;
  console.log(`🔄 Processing ${uploadQueue.size} queued files...`);
  
  const files = Array.from(uploadQueue.entries());
  uploadQueue.clear();
  
  for (const [relativePath, fileInfo] of files) {
    try {
      if (!await fs.pathExists(fileInfo.fullPath)) {
        continue;
      }
      
      // Check if this file was recently downloaded
      const recentDownload = recentlyDownloaded.get(relativePath);
      if (recentDownload) {
        const currentHash = calculateFileHash(fileInfo.fullPath);
        if (currentHash === recentDownload.hash) {
          console.log(`⏭️ Skipping upload for ${relativePath} (matches downloaded version)`);
          continue;
        }
      }
      
      // Upload file to S3 via server
      const remotePath = path.dirname(relativePath);
      const result = await api.uploadFile(fileInfo.fullPath, remotePath === '.' ? '/' : remotePath);
      
      // Update Merkle Tree with S3 URL after successful upload
      if (result.file && result.file.s3Url) {
        merkleTree.updateS3Url(relativePath, result.file.s3Url);
        await saveMerkleTree();
        console.log(`🌳 Updated S3 URL in Merkle Tree for: ${relativePath}`);
      } else {
        console.log(`⚠️ No S3 URL in response for: ${relativePath}`);
      }
      
      // Send updated Merkle Tree metadata to server
      try {
        await api.updateMerkleTree(config.DEVICE_ID, merkleTree.toJSON());
        console.log(`🌳 Sent tree update to server for: ${relativePath}`);
      } catch (updateError) {
        console.error(`⚠️ Failed to update server tree: ${updateError.message}`);
        // Continue processing even if server update fails
      }
      
      // Enhanced feedback based on server response
      if (result.message.includes('updated')) {
        console.log(`🔄 File updated on server: ${relativePath}`);
      } else if (result.message.includes('identical')) {
        console.log(`⏭️ File already up-to-date: ${relativePath}`);
      } else {
        console.log(`✅ File uploaded: ${relativePath}`);
      }
      
      await new Promise(resolve => setTimeout(resolve, 200));
      
    } catch (error) {
      if (error.response?.status === 409) {
        console.log(`⏭️ File ${relativePath} conflict resolved on server`);
      } else {
        console.error(`❌ Failed to upload ${relativePath}:`, error.message);
      }
    }
  }
  
  isProcessing = false;
}

// Handle local file deletion - propagate to server
async function handleLocalDeletion(relativePath) {
  try {
    // Get file info from Merkle Tree before removing it
    const fileInfo = merkleTree.getFile(relativePath);
    
    if (fileInfo) {
      console.log(`🗑️ Local deletion detected: ${relativePath}`);
      
      // Try to delete from server if we have file hash
      if (fileInfo.hash) {
        try {
          await api.deleteFileByHash(fileInfo.hash);
          console.log(`🌐 Deleted from server: ${relativePath}`);
        } catch (serverError) {
          console.error(`⚠️ Failed to delete from server: ${serverError.message}`);
          // Continue with local deletion even if server deletion fails
        }
      }
    }
    
    // Remove from local Merkle Tree
    merkleTree.removeFile(relativePath);
    await saveMerkleTree();
    console.log(`🌳 Removed from Merkle Tree: ${relativePath}`);
    
    // Send updated Merkle Tree to server
    try {
      await api.updateMerkleTree(config.DEVICE_ID, merkleTree.toJSON());
      console.log(`🌳 Updated server tree after deletion: ${relativePath}`);
    } catch (updateError) {
      console.error(`⚠️ Failed to update server tree: ${updateError.message}`);
    }
    
  } catch (error) {
    console.error(`❌ Error handling local deletion: ${error.message}`);
  }
}

function markAsDownloading(relativePath) {
  downloadingFiles.add(relativePath);
}

function markDownloadComplete(relativePath, fileHash) {
  downloadingFiles.delete(relativePath);
  
  recentlyDownloaded.set(relativePath, {
    hash: fileHash,
    timestamp: Date.now()
  });
  
  setTimeout(() => {
    const entry = recentlyDownloaded.get(relativePath);
    if (entry && Date.now() - entry.timestamp > 10000) {
      recentlyDownloaded.delete(relativePath);
    }
  }, 10000);
}

async function startWatcher() {
  await fs.ensureDir(config.WATCH_DIRECTORY);
  
  // Load existing Merkle Tree
  await loadMerkleTree();
  
  console.log(`👀 Watching directory: ${config.WATCH_DIRECTORY}`);
  console.log(`🌳 Merkle Tree root hash: ${merkleTree.getRootHash() || 'empty'}`);
  
  watcher = chokidar.watch(config.WATCH_DIRECTORY, {
    ignored: shouldIgnoreFile,
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 1000,
      pollInterval: 100
    }
  });
  
  watcher
    .on('add', (filePath) => handleFileChange(filePath, 'add'))
    .on('change', (filePath) => handleFileChange(filePath, 'change'))
    .on('unlink', (filePath) => handleFileChange(filePath, 'unlink'))
    .on('error', (error) => console.error('❌ Watcher error:', error))
    .on('ready', () => console.log('✅ File watcher ready'));
}

// Helper function to determine MIME type
function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.txt': 'text/plain',
    '.json': 'application/json',
    '.js': 'application/javascript',
    '.html': 'text/html',
    '.css': 'text/css',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.pdf': 'application/pdf',
    '.zip': 'application/zip'
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

async function stopWatcher() {
  if (watcher) {
    await watcher.close();
    console.log('⏹️ File watcher stopped');
  }
}

module.exports = {
  startWatcher,
  stopWatcher,
  processUploadQueue,
  markAsDownloading,
  markDownloadComplete,
  getMerkleTree: () => merkleTree,
  saveMerkleTree
};