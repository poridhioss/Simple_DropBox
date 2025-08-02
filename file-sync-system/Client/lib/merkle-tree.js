// client/lib/merkle-tree.js
const crypto = require('crypto');
const fs = require('fs-extra');
const path = require('path');

class MerkleNode {
  constructor(data = null, left = null, right = null) {
    this.data = data; // For leaf nodes: file metadata, for internal nodes: null
    this.left = left;
    this.right = right;
    this.hash = this.calculateHash();
    this.isLeaf = !left && !right;
  }

  calculateHash() {
    if (this.isLeaf && this.data) {
      // For leaf nodes, hash is based on file content hash
      return this.data.hash;
    } else if (this.left && this.right) {
      // For internal nodes, hash is combination of children
      const combined = this.left.hash + this.right.hash;
      return crypto.createHash('sha256').update(combined).digest('hex');
    } else if (this.left) {
      // Only left child
      return this.left.hash;
    } else if (this.right) {
      // Only right child  
      return this.right.hash;
    }
    return crypto.createHash('sha256').update('empty').digest('hex');
  }

  recalculateHash() {
    this.hash = this.calculateHash();
  }
}

class MerkleTree {
  constructor() {
    this.root = null;
    this.leaves = new Map(); // Map file paths to leaf nodes
  }

  // Create leaf node for a file
  createFileNode(filePath, metadata) {
    const node = new MerkleNode({
      filename: metadata.filename,
      file_path: filePath,
      local_url: metadata.local_url,
      s3_url: metadata.s3_url || null,
      hash: metadata.hash,
      size: metadata.size,
      timestamp: metadata.timestamp || new Date().toISOString(),
      mime_type: metadata.mime_type
    });
    
    this.leaves.set(filePath, node);
    return node;
  }

  // Add or update a file in the tree
  addOrUpdateFile(filePath, metadata) {
    const existingNode = this.leaves.get(filePath);
    
    if (existingNode) {
      // Update existing node
      existingNode.data = {
        ...existingNode.data,
        ...metadata,
        timestamp: new Date().toISOString()
      };
      existingNode.recalculateHash();
    } else {
      // Create new node
      this.createFileNode(filePath, metadata);
    }
    
    // Rebuild tree from leaves
    this.rebuildTree();
  }

  // Get file information from the tree
  getFile(filePath) {
    const node = this.leaves.get(filePath);
    return node ? node.data : null;
  }

  // Update S3 URL for a file after successful upload
  updateS3Url(filePath, s3Url) {
    const node = this.leaves.get(filePath);
    if (node && node.data) {
      node.data.s3_url = s3Url;
      node.data.timestamp = new Date().toISOString();
      node.recalculateHash();
      this.rebuildTree();
      return true;
    }
    return false;
  }

  // Remove a file from the tree
  removeFile(filePath) {
    const removed = this.leaves.delete(filePath);
    if (removed) {
      this.rebuildTree();
    }
    return removed;
  }

  // Check if file is fully uploaded (has S3 URL)
  isFileUploaded(filePath) {
    const node = this.leaves.get(filePath);
    return node && node.data && node.data.s3_url;
  }

  // Get file metadata
  getFileMetadata(filePath) {
    const node = this.leaves.get(filePath);
    return node ? node.data : null;
  }

  // Get all files
  getAllFiles() {
    const files = [];
    for (const [filePath, node] of this.leaves) {
      if (node.data) {
        files.push({
          file_path: filePath,
          ...node.data
        });
      }
    }
    return files;
  }

  // Get only uploaded files (with S3 URLs)
  getUploadedFiles() {
    return this.getAllFiles().filter(file => file.s3_url);
  }

  // Get pending uploads (files without S3 URLs)
  getPendingUploads() {
    return this.getAllFiles().filter(file => !file.s3_url);
  }

  // Rebuild the tree from leaf nodes
  rebuildTree() {
    const leafNodes = Array.from(this.leaves.values());
    
    if (leafNodes.length === 0) {
      this.root = null;
      return;
    }

    if (leafNodes.length === 1) {
      this.root = leafNodes[0];
      return;
    }

    // Build tree bottom-up
    let currentLevel = [...leafNodes];
    
    while (currentLevel.length > 1) {
      const nextLevel = [];
      
      for (let i = 0; i < currentLevel.length; i += 2) {
        const left = currentLevel[i];
        const right = currentLevel[i + 1] || null;
        
        const parent = new MerkleNode(null, left, right);
        nextLevel.push(parent);
      }
      
      currentLevel = nextLevel;
    }
    
    this.root = currentLevel[0];
  }

  // Get root hash
  getRootHash() {
    return this.root ? this.root.hash : null;
  }

  // Export tree to JSON
  toJSON() {
    return {
      rootHash: this.getRootHash(),
      timestamp: new Date().toISOString(),
      files: this.getAllFiles()
    };
  }

  // Import tree from JSON
  fromJSON(data) {
    this.leaves.clear();
    
    if (data.files) {
      for (const file of data.files) {
        this.createFileNode(file.file_path, file);
      }
    }
    
    this.rebuildTree();
  }

  // Calculate file content hash
  static calculateFileHash(filePath) {
    try {
      const buffer = fs.readFileSync(filePath);
      return crypto.createHash('sha256').update(buffer).digest('hex');
    } catch (error) {
      console.error(`Error calculating hash for ${filePath}:`, error.message);
      return null;
    }
  }

  // Get tree differences between two trees
  getDifferences(otherTree) {
    const myFiles = new Map();
    const otherFiles = new Map();
    
    // Create maps for comparison
    for (const file of this.getAllFiles()) {
      myFiles.set(file.file_path, file);
    }
    
    for (const file of otherTree.getAllFiles()) {
      otherFiles.set(file.file_path, file);
    }
    
    const differences = {
      added: [],
      modified: [],
      deleted: []
    };
    
    // Find added and modified files
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
    
    // Find deleted files
    for (const [filePath, file] of otherFiles) {
      if (!myFiles.has(filePath)) {
        differences.deleted.push(file);
      }
    }
    
    return differences;
  }
}

module.exports = { MerkleTree, MerkleNode };
