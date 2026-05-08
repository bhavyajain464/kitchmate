#!/bin/bash

# Test script for Kitchen AI Go Backend API
# Make sure the backend server is running on port 8080

echo "Testing Kitchen AI Backend API..."
echo "=================================="

# Test 1: Health check
echo -e "\n1. Testing health endpoint:"
curl -s http://localhost:8080/health | jq .

# Test 2: Get inventory
echo -e "\n2. Testing GET /api/v1/inventory:"
curl -s http://localhost:8080/api/v1/inventory | jq .

# Test 3: Create inventory item
echo -e "\n3. Testing POST /api/v1/inventory:"
curl -s -X POST http://localhost:8080/api/v1/inventory \
  -H "Content-Type: application/json" \
  -d '{
    "canonical_name": "Test Item",
    "qty": 10,
    "unit": "pieces",
    "estimated_expiry": "2026-05-15",
    "is_manual": true
  }' | jq .

# Test 4: Get expiring items
echo -e "\n4. Testing GET /api/v1/inventory/expiring:"
curl -s http://localhost:8080/api/v1/inventory/expiring | jq .

# Test 5: Get user preferences
echo -e "\n5. Testing GET /api/v1/user/preferences:"
curl -s http://localhost:8080/api/v1/user/preferences | jq .

# Test 6: Get cook profile
echo -e "\n6. Testing GET /api/v1/cook/profile:"
curl -s http://localhost:8080/api/v1/cook/profile | jq .

echo -e "\n=================================="
echo "API tests completed!"