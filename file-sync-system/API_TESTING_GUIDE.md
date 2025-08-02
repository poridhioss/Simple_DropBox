# API Testing Guide - Simple DropBox with Merkle Tree

This guide provides comprehensive testing instructions for all API endpoints using curl commands, individual test scripts, and automated testing approaches.

## Prerequisites

1. **Start the infrastructure:**
   ```bash
   cd file-sync-system
   docker-compose up -d
   ```

2. **Install and start the server:**
   ```bash
   cd Server
   npm install
   npm run migrate
   npm start
   ```

3. **Server should be running on:** `http://localhost:3000`

---

## Testing Methods

### Method 1: Individual API Tests (Recommended)

Run individual API tests to isolate and debug specific functionality:

```bash
cd Client
npm install  # Make sure dependencies are installed

# Test individual APIs
npm run test-auth        # Test authentication
npm run test-upload      # Test file upload with S3 URL
npm run test-list        # Test file listing
npm run test-download    # Test file download
npm run test-merkle      # Test Merkle Tree operations

# Run all tests in sequence
npm run test-all         # Comprehensive test suite
```

### Method 2: Legacy Automated Test Script

Run the original comprehensive test script:

```bash
cd Client
node test/api-test.js
```

### Method 3: Manual curl Commands

#### 1. Health Check
```bash
curl -X GET http://localhost:3000/health
```

**Expected Response:**
```json
{
  "status": "OK",
  "timestamp": "2025-07-22T18:20:00.000Z"
}
```

#### 2. Authentication

**Register User:**
```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "password123"
  }'
```

**Login (if user exists):**
```bash
curl -X POST http://13.213.60.1:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "password123"
  }'
```


curl -X GET http://13.213.60.1:3000/api/files \
  -H "Authorization: Bearer $TOKEN"

curl -X GET http://13.213.60.1:3000/api/files/e982ad8e-4645-4a40-bffb-08d8a9c070eb/download \
  -H "Authorization: Bearer $TOKEN" | jq -r '.downloadUrl'


curl -X GET http://13.213.60.1:3000/api/files/e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855/download \
  -H "Authorization: Bearer $TOKEN"

DOWNLOAD_URL=$(curl -s -X GET "http://13.213.60.1:3000/api/files/e982ad8e-4645-4a40-bffb-08d8a9c070eb/download" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.downloadUrl')

**Response (save the token):**
```json
{
  "message": "Login successful",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "uuid-here",
    "email": "test@example.com"
  }
}
```

#### 3. Get Current User
```bash
curl -X GET http://localhost:3000/api/auth/me \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

#### 4. File Upload
```bash
# Upload the file
curl -X POST http://localhost:3000/api/files/upload \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI2NTNhODgwMC1kMzQ1LTQwMzAtOTY4MS01Y2JhZTkwMDEzZGUiLCJpYXQiOjE3NTMyMTQxNDAsImV4cCI6MTc1MzMwMDU0MH0._GeXSM114uoi_CDX3ccssiDPk_tJ27aWdv8_1daIj3I" \
  -F "file=@notes3.txt" \
  -F "filePath=notes3.txt" \
  -F "localUrl=/root/code/Simple_DropBox/file-sync-system/Client/sync-folder/notes3.txt"
```

**Expected Response:**
```json
{
  "message": "File uploaded successfully",
  "file": {
    "id": "file-uuid",
    "filename": "test-file.txt",
    "filePath": "/test/test-file.txt",
    "fileSize": 34,
    "fileHash": "sha256-hash",
    "mimeType": "text/plain",
    "localUrl": "/local/path/test-file.txt",
    "s3Url": "http://localhost:9000/filesync-bucket/...",
    "createdAt": "2025-07-22T18:20:00.000Z"
  }
}
```

#### 5. List Files
```bash
curl -X GET http://localhost:3000/api/files \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI2NTNhODgwMC1kMzQ1LTQwMzAtOTY4MS01Y2JhZTkwMDEzZGUiLCJpYXQiOjE3NTMyMDY3MDcsImV4cCI6MTc1MzI5MzEwN30.uk7CKbMEN8eVhRUa4ZzhLOa2wK0ccE68VkeG4HlUT3A"
```

#### 6. Get Download URL
```bash
curl -X GET http://localhost:3000/api/files/FILE_ID_HERE/download \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

#### 7. Merkle Tree Operations

**Update Merkle Tree:**
```bash
curl -X POST http://localhost:3000/api/merkle/update \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -H "Content-Type: application/json" \
  -d '{
    "deviceId": "test-device-001",
    "treeData": {
      "rootHash": "sample-root-hash-123",
      "timestamp": "2025-07-22T18:20:00.000Z",
      "files": [
        {
          "filename": "document1.txt",
          "file_path": "document1.txt",
          "local_url": "/local/path/document1.txt",
          "s3_url": "http://localhost:9000/bucket/document1.txt",
          "hash": "file-hash-1",
          "size": 1024,
          "timestamp": "2025-07-22T18:20:00.000Z",
          "mime_type": "text/plain"
        }
      ]
    }
  }'
```

**Get Merkle Tree:**
```bash
curl -X GET "http://localhost:3000/api/merkle/tree?deviceId=test-device-001" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

**Calculate Tree Differences:**
```bash
curl -X POST http://localhost:3000/api/merkle/diff \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -H "Content-Type: application/json" \
  -d '{
    "deviceId": "test-device-001",
    "localTreeData": {
      "rootHash": "local-root-hash-456",
      "timestamp": "2025-07-22T18:20:00.000Z",
      "files": [
        {
          "filename": "document2.txt",
          "file_path": "document2.txt",
          "local_url": "/local/path/document2.txt",
          "s3_url": null,
          "hash": "file-hash-2",
          "size": 2048,
          "timestamp": "2025-07-22T18:20:00.000Z",
          "mime_type": "text/plain"
        }
      ]
    }
  }'
```

**List All Device Trees:**
```bash
curl -X GET http://localhost:3000/api/merkle/devices \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

---

## Method 3: Using the Client Application

### Test with File Watcher:

1. **Start the client:**
   ```bash
   cd Client
   npm start
   ```

2. **Add files to sync folder:**
   ```bash
   echo "Test content" > sync-folder/test.txt
   ```

3. **Watch the console output for:**
   - File detection
   - Merkle Tree updates
   - Upload progress
   - Server synchronization

### Test with Examples:

```bash
# Upload example
npm run upload

# Download example  
npm run download

# Merkle Tree example
npm run merkle-example
```

---

## Expected Workflow Testing

### Complete File Upload Workflow:

1. **Create a file** in the sync-folder
2. **File watcher detects** the change
3. **Local Merkle Tree updated** (without s3_url)
4. **File uploaded** to MinIO via server
5. **Merkle Tree updated** with s3_url
6. **Server tree updated** with new state
7. **Sync process** verifies consistency

### Multi-Device Sync Testing:

1. **Run client on device 1** with `DEVICE_ID=device-1`
2. **Add files** and verify upload
3. **Run client on device 2** with `DEVICE_ID=device-2`
4. **Verify files sync** to device 2
5. **Check tree differences** between devices

---

## Troubleshooting

### Common Issues:

1. **Server not responding:**
   - Check if PostgreSQL and MinIO are running: `docker-compose ps`
   - Verify server is running: `curl http://localhost:3000/health`

2. **Authentication errors:**
   - Ensure JWT_SECRET is set in server/.env
   - Check token expiration

3. **File upload failures:**
   - Verify MinIO is accessible: `http://localhost:9001` (admin/admin)
   - Check file size limits (100MB default)

4. **Merkle Tree sync errors:**
   - Check database migrations: `npm run migrate`
   - Verify merkle_trees table exists

### Debug Commands:

```bash
# Check database tables
docker exec -it filesync-postgres psql -U postgres -d filesync -c "\dt"

# Check MinIO buckets
docker exec -it filesync-minio mc ls minio/

# View server logs
cd Server && npm run dev

# View client logs with debug
cd Client && DEBUG=* npm start
```

---

## Individual API Test Scripts

The new individual test scripts provide focused testing for each API endpoint with detailed output and error handling.

### 1. Authentication Test
```bash
npm run test-auth
```
**What it tests:**
- User login functionality
- JWT token generation and validation
- Token persistence

**Expected Output:**
```
🔐 Testing Authentication...
Testing login...
✅ Login successful
🔍 Testing token validation...
✅ Token valid - found X files
📝 Token status: Present
```

### 2. Upload API Test
```bash
npm run test-upload
```
**What it tests:**
- File upload to MinIO via server
- S3 URL generation
- Duplicate file handling
- Response format validation

**Expected Output:**
```
🔐 Authenticating...
✅ Authentication successful
📝 Created test file: /path/to/test-file.txt
📤 Uploading file...
✅ Upload API Response:
{
  "message": "File uploaded successfully",
  "file": {
    "id": "uuid",
    "filename": "test-file.txt",
    "s3Url": "http://localhost:9000/filesync-bucket/..."
  }
}
✅ S3 URL generated successfully
```

### 3. List Files API Test
```bash
npm run test-list
```
**What it tests:**
- File listing functionality
- Metadata retrieval
- Response format validation

### 4. Download API Test
```bash
npm run test-download
```
**What it tests:**
- File download from MinIO
- File integrity verification
- Download path handling

### 5. Merkle Tree API Test
```bash
npm run test-merkle
```
**What it tests:**
- Merkle Tree update operations
- Tree difference calculations
- Device management
- Tree synchronization

### 6. Comprehensive Test Suite
```bash
npm run test-all
```
**What it tests:**
- Runs all individual tests in sequence
- Provides summary report
- Shows pass/fail status for each API

**Sample Output:**
```
🚀 Starting comprehensive API tests...

==================================================
🧪 Testing: Authentication API
==================================================
✅ Authentication API - PASSED

==================================================
🧪 Testing: Upload API  
==================================================
✅ Upload API - PASSED

📊 TEST RESULTS SUMMARY
==================================================
✅ Authentication API: PASSED
✅ Upload API: PASSED
✅ List Files API: PASSED
✅ Download API: PASSED
✅ Merkle Tree API: PASSED

📈 Overall: 5/5 tests passed
```

---

## Performance Testing

### Load Testing with Multiple Files:

```bash
# Create multiple test files
for i in {1..10}; do
  echo "Content of file $i" > "sync-folder/file_$i.txt"
done
```

### Concurrent Device Testing:

```bash
# Terminal 1
DEVICE_ID=device-1 npm start

# Terminal 2  
DEVICE_ID=device-2 WATCH_DIRECTORY=./sync-folder-2 npm start
```

This comprehensive testing approach will help you verify that all components of the Merkle Tree-based file synchronization system are working correctly.
