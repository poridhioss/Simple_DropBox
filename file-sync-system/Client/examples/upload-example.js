// client/examples/upload-example.js
const api = require('../lib/api');
const config = require('../config');
const fs = require('fs');
const path = require('path');
const { MerkleTree } = require('../lib/merkle-tree');

async function uploadExample() {
  try {
    console.log('🔐 Authenticating...');
    await api.authenticate();
    
    // Create a test file
    const testFile = path.join(config.WATCH_DIRECTORY, 'test-upload.txt');
    const testContent = `Test file created at ${new Date().toISOString()}\nThis is a test upload!`;
    
    // Ensure directory exists
    fs.mkdirSync(config.WATCH_DIRECTORY, { recursive: true });
    fs.writeFileSync(testFile, testContent);
    
    console.log('📝 Created test file:', testFile);
    
    // Upload the file
    console.log('📤 Uploading file...');
    const result = await api.uploadFile(testFile);
    
    console.log('✅ Upload successful!');
    console.log('📄 File info:', {
      id: result.file.id,
      name: result.file.filename,
      size: result.file.fileSize,
      path: result.file.filePath,
      s3Url: result.file.s3Url || 'null'
    });

    // Update Merkle Tree with S3 URL after successful upload
    if (result.file && result.file.s3Url) {
      console.log('🌳 Updating Merkle Tree with S3 URL...');
      
      // Load existing Merkle Tree
      const merkleTreePath = path.join(__dirname, '..', 'merkle-tree.json');
      let merkleTree;
      
      if (fs.existsSync(merkleTreePath)) {
        const treeData = JSON.parse(fs.readFileSync(merkleTreePath, 'utf8'));
        merkleTree = MerkleTree.fromJSON(treeData);
      } else {
        merkleTree = new MerkleTree();
      }
      
      // Update S3 URL in the tree
      const relativePath = path.relative(config.WATCH_DIRECTORY, testFile);
      merkleTree.updateS3Url(relativePath, result.file.s3Url);
      
      // Save updated tree
      fs.writeFileSync(merkleTreePath, JSON.stringify(merkleTree.toJSON(), null, 2));
      
      // Send updated tree to server
      try {
        await api.updateMerkleTree(config.DEVICE_ID, merkleTree.toJSON());
        console.log('🌳 Merkle Tree updated successfully!');
      } catch (updateError) {
        console.error('⚠️ Failed to update server tree:', updateError.message);
      }
    } else {
      console.log('⚠️ No S3 URL returned from upload');
    }
    
    // List all files
    console.log('\n📋 All files:');
    const files = await api.listFiles();
    files.forEach(file => {
      console.log(`  - ${file.filename} (${file.file_size} bytes)`);
    });
    
  } catch (error) {
    console.error('❌ Example failed:', error.message);
  }
}

uploadExample();