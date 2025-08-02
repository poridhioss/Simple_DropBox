// test/api-test.js - API Endpoint Testing Script
const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const FormData = require('form-data');

const config = {
  BASE_URL: 'http://localhost:3000/api',
  USER_EMAIL: 'test@example.com',
  USER_PASSWORD: 'password123',
  DEVICE_ID: 'test-device-001'
};

let authToken = null;

// Helper function to make authenticated requests
const apiCall = async (method, endpoint, data = null, headers = {}) => {
  try {
    const config_obj = {
      method,
      url: `${config.BASE_URL}${endpoint}`,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };

    if (authToken) {
      config_obj.headers.Authorization = `Bearer ${authToken}`;
    }

    if (data) {
      if (data instanceof FormData) {
        config_obj.data = data;
        config_obj.headers = { ...config_obj.headers, ...data.getHeaders() };
      } else {
        config_obj.data = data;
      }
    }

    const response = await axios(config_obj);
    return response.data;
  } catch (error) {
    console.error(`❌ API Error [${method} ${endpoint}]:`, error.response?.data || error.message);
    throw error;
  }
};

async function testAuthentication() {
  console.log('\n🔐 Testing Authentication...');
  
  try {
    // Test registration/login
    const authResult = await apiCall('POST', '/auth/register', {
      email: config.USER_EMAIL,
      password: config.USER_PASSWORD
    });
    
    authToken = authResult.token;
    console.log('✅ Authentication successful');
    console.log(`   Token: ${authToken.substring(0, 20)}...`);
    
    // Test getting current user
    const userResult = await apiCall('GET', '/auth/me');
    console.log('✅ User info retrieved');
    console.log(`   User ID: ${userResult.user.id}`);
    console.log(`   Email: ${userResult.user.email}`);
    
    return authResult;
  } catch (error) {
    if (error.response?.status === 409) {
      // User already exists, try login
      console.log('🔄 User exists, trying login...');
      const loginResult = await apiCall('POST', '/auth/login', {
        email: config.USER_EMAIL,
        password: config.USER_PASSWORD
      });
      authToken = loginResult.token;
      console.log('✅ Login successful');
      return loginResult;
    }
    throw error;
  }
}

async function testFileUpload() {
  console.log('\n📤 Testing File Upload...');
  
  // Create a test file
  const testDir = path.join(__dirname, 'temp');
  await fs.ensureDir(testDir);
  
  const testFile = path.join(testDir, 'test-upload.txt');
  const testContent = `Test file created at ${new Date().toISOString()}\nHello from API test!`;
  await fs.writeFile(testFile, testContent);
  
  console.log(`📝 Created test file: ${testFile}`);
  
  try {
    // Create form data
    const form = new FormData();
    form.append('file', fs.createReadStream(testFile));
    form.append('filePath', '/test');
    form.append('localUrl', testFile);
    
    const uploadResult = await apiCall('POST', '/files/upload', form);
    console.log('✅ File upload successful');
    console.log(`   File ID: ${uploadResult.file.id}`);
    console.log(`   S3 URL: ${uploadResult.file.s3Url}`);
    console.log(`   File Hash: ${uploadResult.file.fileHash}`);
    
    return uploadResult.file;
  } finally {
    // Cleanup
    await fs.remove(testDir);
  }
}

async function testMerkleTreeOperations() {
  console.log('\n🌳 Testing Merkle Tree Operations...');
  
  // Sample Merkle Tree data
  const sampleTreeData = {
    rootHash: 'sample-root-hash-12345',
    timestamp: new Date().toISOString(),
    files: [
      {
        filename: 'document1.txt',
        file_path: 'document1.txt',
        local_url: '/local/path/document1.txt',
        s3_url: 'http://localhost:9000/bucket/document1.txt',
        hash: 'file-hash-1',
        size: 1024,
        timestamp: new Date().toISOString(),
        mime_type: 'text/plain'
      },
      {
        filename: 'document2.txt',
        file_path: 'document2.txt',
        local_url: '/local/path/document2.txt',
        s3_url: null, // Not uploaded yet
        hash: 'file-hash-2',
        size: 2048,
        timestamp: new Date().toISOString(),
        mime_type: 'text/plain'
      }
    ]
  };
  
  try {
    // Test updating Merkle Tree
    console.log('🔄 Testing tree update...');
    const updateResult = await apiCall('POST', '/merkle/update', {
      deviceId: config.DEVICE_ID,
      treeData: sampleTreeData
    });
    console.log('✅ Merkle tree update successful');
    console.log(`   Tree ID: ${updateResult.tree.id}`);
    console.log(`   Root Hash: ${updateResult.tree.rootHash}`);
    console.log(`   Version: ${updateResult.tree.version}`);
    
    // Test getting Merkle Tree
    console.log('🔄 Testing tree retrieval...');
    const getResult = await apiCall('GET', `/merkle/tree?deviceId=${config.DEVICE_ID}`);
    console.log('✅ Merkle tree retrieval successful');
    console.log(`   Files in tree: ${getResult.tree.treeData.files.length}`);
    
    // Test tree differences
    console.log('🔄 Testing tree differences...');
    const modifiedTreeData = {
      ...sampleTreeData,
      files: [
        ...sampleTreeData.files,
        {
          filename: 'document3.txt',
          file_path: 'document3.txt',
          local_url: '/local/path/document3.txt',
          s3_url: 'http://localhost:9000/bucket/document3.txt',
          hash: 'file-hash-3',
          size: 512,
          timestamp: new Date().toISOString(),
          mime_type: 'text/plain'
        }
      ]
    };
    
    const diffResult = await apiCall('POST', '/merkle/diff', {
      deviceId: config.DEVICE_ID,
      localTreeData: modifiedTreeData
    });
    console.log('✅ Tree differences calculation successful');
    console.log(`   Added: ${diffResult.differences.added.length}`);
    console.log(`   Modified: ${diffResult.differences.modified.length}`);
    console.log(`   Deleted: ${diffResult.differences.deleted.length}`);
    
    // Test listing devices
    console.log('🔄 Testing device listing...');
    const devicesResult = await apiCall('GET', '/merkle/devices');
    console.log('✅ Device listing successful');
    console.log(`   Devices found: ${devicesResult.devices.length}`);
    
    return updateResult;
  } catch (error) {
    console.error('❌ Merkle tree operations failed:', error.message);
    throw error;
  }
}

async function testFileOperations() {
  console.log('\n📁 Testing File Operations...');
  
  try {
    // List files
    console.log('🔄 Testing file listing...');
    const filesResult = await apiCall('GET', '/files');
    console.log('✅ File listing successful');
    console.log(`   Files found: ${filesResult.files.length}`);
    
    if (filesResult.files.length > 0) {
      const firstFile = filesResult.files[0];
      console.log(`   First file: ${firstFile.filename} (${firstFile.file_size} bytes)`);
      
      // Test download URL generation
      console.log('🔄 Testing download URL generation...');
      const downloadResult = await apiCall('GET', `/files/${firstFile.id}/download`);
      console.log('✅ Download URL generation successful');
      console.log(`   Download URL: ${downloadResult.downloadUrl.substring(0, 50)}...`);
    }
    
    return filesResult;
  } catch (error) {
    console.error('❌ File operations failed:', error.message);
    throw error;
  }
}

async function testHealthCheck() {
  console.log('\n🔍 Testing Health Check...');
  
  try {
    const response = await axios.get(`${config.BASE_URL.replace('/api', '')}/health`);
    console.log('✅ Health check successful');
    console.log(`   Status: ${response.data.status}`);
    console.log(`   Timestamp: ${response.data.timestamp}`);
    return response.data;
  } catch (error) {
    console.error('❌ Health check failed:', error.message);
    throw error;
  }
}

async function runAllTests() {
  console.log('🚀 Starting API Endpoint Tests');
  console.log('================================');
  
  try {
    await testHealthCheck();
    await testAuthentication();
    await testFileUpload();
    await testMerkleTreeOperations();
    await testFileOperations();
    
    console.log('\n🎉 All tests completed successfully!');
    console.log('====================================');
    
  } catch (error) {
    console.error('\n💥 Test suite failed:', error.message);
    process.exit(1);
  }
}

// Export for use in other scripts
module.exports = {
  testAuthentication,
  testFileUpload,
  testMerkleTreeOperations,
  testFileOperations,
  testHealthCheck,
  apiCall
};

// Run tests if this file is executed directly
if (require.main === module) {
  runAllTests();
}
