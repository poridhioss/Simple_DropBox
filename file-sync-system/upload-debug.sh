#!/bin/bash
# upload-debug.sh - Debug upload API issues

echo "🔍 Debugging Upload API Issues"
echo "=============================="

# Check if server is running
echo "1. Testing server health..."
curl -s http://localhost:3000/health || echo "❌ Server not responding"

# Check if file exists
echo -e "\n2. Checking if test file exists..."
if [ -f "notes3.txt" ]; then
    echo "✅ File exists: $(ls -la notes3.txt)"
    echo "   Content preview:"
    head -3 notes3.txt | sed 's/^/   /'
else
    echo "❌ File notes3.txt not found in current directory"
    echo "   Creating test file..."
    echo "test content" > notes3.txt
fi

# Test authentication first
echo -e "\n3. Testing authentication..."
AUTH_RESPONSE=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "password123"
  }')

if echo "$AUTH_RESPONSE" | grep -q "token"; then
    TOKEN=$(echo "$AUTH_RESPONSE" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
    echo "✅ Authentication successful"
    echo "   Token: ${TOKEN:0:20}..."
else
    echo "❌ Authentication failed"
    echo "   Response: $AUTH_RESPONSE"
    exit 1
fi

# Test file upload with detailed output
echo -e "\n4. Testing file upload with verbose output..."
curl -v -X POST http://localhost:3000/api/files/upload \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@notes3.txt" \
  -F "filePath=/test" \
  -F "localUrl=$(pwd)/notes3.txt"

echo -e "\n5. Testing MinIO connectivity..."
curl -s http://localhost:9000/minio/health/live || echo "❌ MinIO not responding"

echo -e "\n6. Checking Docker containers..."
docker-compose ps

echo -e "\nDebugging complete!"
