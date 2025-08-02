// test/quick-test.js - Quick API validation
const axios = require('axios');

const BASE_URL = 'http://localhost:3000';

async function quickTest() {
  console.log('🚀 Quick API Test');
  console.log('================');
  
  try {
    // Test 1: Health check
    console.log('1. Testing health endpoint...');
    const healthResponse = await axios.get(`${BASE_URL}/health`);
    console.log('   ✅ Health check passed:', healthResponse.data.status);
    
    // Test 2: Authentication
    console.log('2. Testing authentication...');
    const authResponse = await axios.post(`${BASE_URL}/api/auth/register`, {
      email: 'quicktest@example.com',
      password: 'password123'
    }).catch(async (error) => {
      if (error.response?.status === 409) {
        // User exists, try login
        return await axios.post(`${BASE_URL}/api/auth/login`, {
          email: 'quicktest@example.com',
          password: 'password123'
        });
      }
      throw error;
    });
    
    const token = authResponse.data.token;
    console.log('   ✅ Authentication passed');
    
    // Test 3: Protected endpoint
    console.log('3. Testing protected endpoint...');
    const userResponse = await axios.get(`${BASE_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    console.log('   ✅ Protected endpoint passed:', userResponse.data.user.email);
    
    // Test 4: Merkle tree endpoint
    console.log('4. Testing Merkle tree endpoint...');
    const treeResponse = await axios.post(`${BASE_URL}/api/merkle/update`, {
      deviceId: 'quick-test-device',
      treeData: {
        rootHash: 'test-hash',
        timestamp: new Date().toISOString(),
        files: []
      }
    }, {
      headers: { Authorization: `Bearer ${token}` }
    });
    console.log('   ✅ Merkle tree endpoint passed');
    
    console.log('\n🎉 All quick tests passed! Server is working correctly.');
    
  } catch (error) {
    console.error('\n❌ Quick test failed:', error.message);
    if (error.response) {
      console.error('   Status:', error.response.status);
      console.error('   Data:', error.response.data);
    }
    
    console.log('\n🔧 Troubleshooting steps:');
    console.log('   1. Make sure Docker containers are running: docker-compose ps');
    console.log('   2. Check if server is running: npm start (in Server directory)');
    console.log('   3. Verify database migrations: npm run migrate (in Server directory)');
  }
}

quickTest();
