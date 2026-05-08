# 🚀 Quick Setup Guide

## Prerequisites

1. **PostgreSQL**: Install PostgreSQL 14+ or use Supabase
2. **Go**: Version 1.21+ 
3. **Node.js**: Version 18+ with npm
4. **Expo CLI**: For React Native development

## Step-by-Step Setup

### 1. Clone and Navigate
```bash
git clone <repository-url>
cd Kitchenai
```

### 2. Database Setup
```bash
# Option A: Local PostgreSQL
createdb kitchenai
psql -d kitchenai -f database/schema.sql

# Option B: Supabase
# 1. Create a new project on supabase.com
# 2. Run the SQL from database/schema.sql in the SQL editor
# 3. Note your database connection string
```

### 3. Backend Setup
```bash
cd backend

# Install Go dependencies
go mod download

# Set environment variables
export DATABASE_URL="postgres://user:password@localhost:5432/kitchenai?sslmode=disable"
export PORT="8080"

# Run the server
go run cmd/api/main.go
```

### 4. Frontend Setup
```bash
cd frontend/kitchenai-frontend

# Install dependencies
npm install

# Update API URL if needed (edit App.tsx line 8)
# const API_BASE_URL = 'http://localhost:8080/api/v1';

# Start Expo
npx expo start

# Scan QR code with Expo Go app (iOS/Android)
```

### 5. MCP Server Setup (Optional)
```bash
cd mcp-server

# Install dependencies
npm install

# Build and run
npm run build
npm start
```

## Testing the System

### Test Backend API
```bash
cd backend
chmod +x test_api.sh
./test_api.sh
```

Expected output:
- Health check returns `{"status": "healthy"}`
- Inventory endpoints return JSON data
- Sample data from schema.sql should appear

### Test Frontend
1. Open Expo Go app on your phone
2. Scan QR code from terminal
3. App should show:
   - Kitchen AI header
   - Inventory stats
   - Expiring items (sample data)
   - Quick action buttons

## Configuration Files

### Backend Configuration (`backend/pkg/config/config.go`)
- `PORT`: Server port (default: 8080)
- `DATABASE_URL`: PostgreSQL connection string
- `ENVIRONMENT`: `development` or `production`

### Frontend Configuration (`frontend/kitchenai-frontend/App.tsx`)
- `API_BASE_URL`: Backend API URL (line 8)

### MCP Server Configuration (`mcp-server/.env`)
```env
DATABASE_URL=postgres://user:password@localhost:5432/kitchenai
```

## Next Steps for Development

### Week 2: Vision Engine
1. Integrate Gemini 1.5 Pro API
2. Implement bill scanning with OCR
3. Create image processing pipeline

### Week 3: Cook Integration
1. Set up Twilio/WhatsApp Business API
2. Implement language translation (Hindi/Kannada)
3. Create message templates

### Week 4: Reasoning Layer
1. Enhance "Rescue Meal" algorithm
2. Integrate recipe database
3. Implement meal planning logic

### Week 5: Frontend Polish
1. Add bill scanning UI
2. Implement real-time updates
3. Add push notifications

### Week 6: Beta Testing
1. Deploy to test environment
2. Onboard test households
3. Collect feedback and iterate

## Troubleshooting

### Database Connection Issues
```bash
# Test PostgreSQL connection
psql -h localhost -p 5432 -U postgres -d kitchenai

# Check if tables exist
psql -d kitchenai -c "\dt"
```

### Go Backend Issues
```bash
# Check Go version
go version

# Clean build
go clean -modcache
go mod tidy
go run cmd/api/main.go
```

### React Native Issues
```bash
# Clear Expo cache
npx expo start --clear

# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install
```

### MCP Server Issues
```bash
# Check TypeScript compilation
npx tsc --noEmit

# Install missing dependencies
npm install @modelcontextprotocol/sdk pg dotenv
```

## Deployment

### Backend Deployment (Production)
```bash
# Build binary
cd backend
go build -o kitchenai-backend cmd/api/main.go

# Run with environment variables
DATABASE_URL="your_production_db" PORT="8080" ./kitchenai-backend
```

### Frontend Deployment
```bash
# Build for production
cd frontend/kitchenai-frontend
npx expo build:android
npx expo build:ios
```

## Support

For issues or questions:
1. Check the README.md for detailed documentation
2. Review the plan.txt for project requirements
3. Test with the provided test scripts

---

**🎉 Your Kitchen AI foundation is now set up!** 
Proceed to Week 2 implementation as per the project plan.