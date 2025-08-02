// Test script for permanent S3 URL system
const api = require('../lib/api');
const config = require('../config');
const fs = require('fs');
const path = require('path');

async function testPermanentUrls() {
  try {
    console.log('🔐 Authenticating...');
    await api.authenticate();
    console.log('✅ Authentication successful\n');

    // Create a test file
    const testFile = path.join(config.WATCH_DIRECTORY, `url-test-${Date.now()}.txt`);
    const testContent = `Permanent URL test file created at ${new Date().toISOString()}`;
    
    fs.mkdirSync(config.WATCH_DIRECTORY, { recursive: true });
    fs.writeFileSync(testFile, testContent);
    console.log('📝 Created test file:', testFile);

    // Upload the file
    console.log('\n📤 Uploading file...');
    const uploadResult = await api.uploadFile(testFile);
    
    console.log('✅ Upload successful!');
    console.log('📄 File info:');
    console.log(`  ID: ${uploadResult.file.id}`);
    console.log(`  Filename: ${uploadResult.file.filename}`);
    console.log(`  S3 URL (first): ${uploadResult.file.s3Url}`);

    // Wait a moment
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Get fresh URL multiple times to test if they're different (presigned URLs should be unique)
    console.log('\n🔄 Testing fresh URL generation...');
    
    const freshUrl1 = await api.getFreshFileUrl(uploadResult.file.id, 1); // 1 hour
    console.log(`Fresh URL #1: ${freshUrl1.url}`);
    console.log(`Expires at: ${freshUrl1.expiresAt}`);

    await new Promise(resolve => setTimeout(resolve, 1000));

    const freshUrl2 = await api.getFreshFileUrl(uploadResult.file.id, 24); // 24 hours
    console.log(`\nFresh URL #2: ${freshUrl2.url}`);
    console.log(`Expires at: ${freshUrl2.expiresAt}`);

    // Test if URLs are different (they should be as they're presigned)
    if (uploadResult.file.s3Url !== freshUrl1.url) {
      console.log('✅ URLs are different (good - presigned URLs are unique)');
    } else {
      console.log('⚠️ URLs are the same');
    }

    // Test URL access
    console.log('\n🌐 Testing URL access...');
    try {
      const axios = require('axios');
      const response = await axios.head(freshUrl1.url);
      console.log(`✅ URL is accessible (status: ${response.status})`);
      console.log(`Content-Length: ${response.headers['content-length']}`);
      console.log(`Content-Type: ${response.headers['content-type']}`);
    } catch (error) {
      console.log(`❌ URL access failed: ${error.message}`);
    }

    // List all files to verify storage
    console.log('\n📋 All files:');
    const files = await api.listFiles();
    files.forEach(file => {
      console.log(`  - ${file.filename} (${file.file_size} bytes) - ID: ${file.id}`);
    });

    // Clean up
    fs.unlinkSync(testFile);
    console.log('\n🧹 Cleaned up test file');

    console.log('\n✅ Permanent URL system test completed!');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    if (error.response) {
      console.error('Server response:', error.response.data);
    }
  }
}

if (require.main === module) {
  testPermanentUrls();
}

module.exports = testPermanentUrls;
