// examples/merkle-tree-example.js
const api = require('../lib/api');
const config = require('../config');
const { MerkleTree } = require('../lib/merkle-tree');
const fs = require('fs-extra');
const path = require('path');

async function merkleTreeExample() {
  try {
    console.log('🌳 Merkle Tree Example');
    console.log('=====================');
    
    // Authenticate
    console.log('🔐 Authenticating...');
    await api.authenticate();
    
    // Create a local Merkle Tree
    const merkleTree = new MerkleTree();
    
    // Create some test files
    const testFiles = [
      { name: 'document1.txt', content: 'This is the first document' },
      { name: 'document2.txt', content: 'This is the second document' },
      { name: 'image.txt', content: 'Fake image content' }
    ];
    
    console.log('\n📝 Creating test files and building Merkle Tree...');
    
    for (const testFile of testFiles) {
      const filePath = path.join(config.WATCH_DIRECTORY, testFile.name);
      
      // Ensure directory exists
      await fs.ensureDir(config.WATCH_DIRECTORY);
      
      // Write file
      await fs.writeFile(filePath, testFile.content);
      
      // Calculate hash
      const hash = MerkleTree.calculateFileHash(filePath);
      const stats = await fs.stat(filePath);
      
      // Add to Merkle Tree
      merkleTree.addOrUpdateFile(testFile.name, {
        filename: testFile.name,
        local_url: filePath,
        s3_url: null, // Not uploaded yet
        hash: hash,
        size: stats.size,
        mime_type: 'text/plain'
      });
      
      console.log(`  ✅ Added ${testFile.name} (hash: ${hash.substring(0, 8)}...)`);
    }
    
    console.log(`\n🌳 Merkle Tree Root Hash: ${merkleTree.getRootHash()}`);
    console.log(`📊 Total files in tree: ${merkleTree.getAllFiles().length}`);
    console.log(`⏳ Pending uploads: ${merkleTree.getPendingUploads().length}`);
    console.log(`✅ Uploaded files: ${merkleTree.getUploadedFiles().length}`);
    
    // Simulate uploading first file
    console.log('\n📤 Simulating file upload...');
    const firstFile = testFiles[0];
    const firstFilePath = path.join(config.WATCH_DIRECTORY, firstFile.name);
    
    try {
      const uploadResult = await api.uploadFile(firstFilePath, '/');
      
      // Update Merkle Tree with S3 URL
      if (uploadResult.file && uploadResult.file.s3Url) {
        merkleTree.updateS3Url(firstFile.name, uploadResult.file.s3Url);
        console.log(`  ✅ Updated ${firstFile.name} with S3 URL`);
      }
    } catch (error) {
      console.log(`  ⚠️ Upload simulation: ${error.message}`);
    }
    
    // Send Merkle Tree to server
    console.log('\n🔄 Sending Merkle Tree to server...');
    try {
      await api.updateMerkleTree(config.DEVICE_ID, merkleTree.toJSON());
      console.log('  ✅ Merkle Tree updated on server');
    } catch (error) {
      console.log(`  ⚠️ Server update: ${error.message}`);
    }
    
    // Display final tree state
    console.log('\n📋 Final Merkle Tree State:');
    console.log('============================');
    console.log(`Root Hash: ${merkleTree.getRootHash()}`);
    console.log(`Total Files: ${merkleTree.getAllFiles().length}`);
    console.log(`Uploaded: ${merkleTree.getUploadedFiles().length}`);
    console.log(`Pending: ${merkleTree.getPendingUploads().length}`);
    
    console.log('\n📄 Files in tree:');
    for (const file of merkleTree.getAllFiles()) {
      const status = file.s3_url ? '✅ Uploaded' : '⏳ Pending';
      console.log(`  ${status} ${file.filename} (${file.size} bytes)`);
    }
    
    // Export tree to JSON
    const treeJson = merkleTree.toJSON();
    const exportPath = path.join(config.WATCH_DIRECTORY, 'merkle-tree-export.json');
    await fs.writeJSON(exportPath, treeJson, { spaces: 2 });
    console.log(`\n💾 Exported Merkle Tree to: ${exportPath}`);
    
  } catch (error) {
    console.error('❌ Example failed:', error.message);
  }
}

// Run the example
if (require.main === module) {
  merkleTreeExample();
}

module.exports = merkleTreeExample;
