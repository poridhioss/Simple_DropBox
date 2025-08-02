// client/examples/download-example.js
const api = require('../lib/api');
const config = require('../config');
const path = require('path');

async function downloadExample() {
  try {
    console.log('🔐 Authenticating...');
    await api.authenticate();
    
    // List files to find one to download
    console.log('📋 Getting file list...');
    const files = await api.listFiles();
    
    if (files.length === 0) {
      console.log('📁 No files found. Upload a file first.');
      return;
    }
    
    // Download the first file
    const file = files[0];
    console.log(`📥 Downloading: ${file.filename}`);
    
    const downloadPath = path.join(config.WATCH_DIRECTORY, 'downloaded-' + file.filename);
    await api.downloadFile(file.id, downloadPath);
    
    console.log('✅ Download completed!');
    console.log('💾 Saved to:', downloadPath);
    
  } catch (error) {
    console.error('❌ Download example failed:', error.message);
  }
}

downloadExample();