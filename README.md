# 🍳 Kitchen AI - AI-powered Kitchen Operating System

An intelligent kitchen management system tailored for the Indian context (specifically Bengaluru) that bridges household inventory, meal planning, and cook management.

## 📋 Problem Statement

Managing a household kitchen in urban India involves high cognitive load due to:
- **"What to Cook?" Fatigue**: Decision paralysis despite having a fridge full of food
- **Communication Gap**: Inability to effectively coordinate with cooks (language barriers, last-minute changes)
- **Food Waste Crisis**: Significant grocery wastage due to forgotten expiry dates and "panic buying"

## 🎯 Goal

Create a central "Kitchen OS" that:
- Automates inventory tracking via bill-scanning
- Suggests meals based on cook-skills and food expiry
- Acts as a communication bridge to the cook via WhatsApp

## 🏗️ System Architecture

The app uses a **Go REST API** as the primary backend; an optional **MCP server** (`mcp-server/`) can expose tools for external LLM workflows.

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Frontend      │    │   Go API        │    │   PostgreSQL    │
│   (Expo RN)     │◄──►│   (Gorilla Mux) │◄──►│   (inventory,   │
└─────────────────┘    └─────────────────┘    │    prefs, cook) │
         │                       │               └─────────────────┘
         │                       │
         ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│ User's WhatsApp │    │ Optional Kafka  │    │ LLM (Groq or    │
│ (wa.me links)   │    │ (shelf-life)    │    │ Gemini) bill /  │
└─────────────────┘    └─────────────────┘    │ meals / shelf   │
                                                └─────────────────┘
```

## 🚀 Features

### Phase 1: Core Automation (MVP)
- **Zero-Entry Inventory**: Auto-populate pantry by snapping photos of grocery bills
- **Expiry Rescue**: AI monitors shelf-life and triggers "Rescue Meal" suggestions
- **Cook Skill Mapping**: Store profile of dishes the cook knows
- **WhatsApp Bridge**: Send daily menu and instructions to cook in native language (Kannada/Hindi)

### Phase 2: Intelligent Procurement
- **Pre-Market Ping**: Automatically ask cook what's running low
- **Smart Shopping List**: Generate list of only what's missing

## 🛠️ Technical Stack

- **Mobile**: React Native (Expo) with TypeScript
- **Backend**: Go (Golang) with Gorilla Mux
- **AI**: Groq and/or Google Gemini (multimodal where supported); optional **MCP** server for tooling
- **Model**: Configurable LLM — **Groq** (default) or **Google Gemini** for vision/text (`LLM_PROVIDER`)
- **Database**: PostgreSQL (Supabase)
- **WhatsApp handoff**: Opens the **household member's** WhatsApp with a pre-filled draft to the cook (`https://wa.me/...`) — no Twilio or Business API in the backend.

## Current stack & configuration (what the repo runs today)

| Layer | Notes |
|--------|--------|
| **Backend** | Go (`kitchenai-backend`), `cmd/api/main.go`. Loads **`backend/.env`** at startup via `godotenv` (optional file). |
| **LLM** | **`LLM_PROVIDER`**: `groq` (default) or `gemini`. Bill scan, smart meals, and shelf-life use **one** provider per request (no automatic fallback). Keys: `GROQ_API_KEY`, optional `GROQ_MODEL` / `GROQ_VISION_MODEL`; or `GEMINI_API_KEY` / `GEMINI_MODEL` when `LLM_PROVIDER=gemini`. |
| **WhatsApp** | API returns **`whatsapp_url`** + **`body`**; the **client** opens WhatsApp. Cook destination uses **`cook_profile.phone_number`** (E.164, digits only in `wa.me` link) and optional **`cook_name`** for greetings. |
| **Kafka** | Optional async shelf-life (`KAFKA_ENABLED`, `KAFKA_BROKERS`, …). When disabled, producer/consumer stay off. |
| **Auth** | Google OAuth + JWT; `GOOGLE_CLIENT_ID`, `SESSION_TOKEN_SECRET` on backend. Frontend uses `EXPO_PUBLIC_*` (see `GOOGLE_OAUTH_SETUP.md`). |

Historical **week-by-week** sections below still describe milestone wording; where they conflict with the table above, **trust the table and `backend/.env.example`**.

## 📁 Project Structure

```
Kitchenai/
├── backend/                    # Go backend API
│   ├── cmd/api/main.go        # Main server entry point
│   ├── internal/
│   │   ├── db/               # Database layer
│   │   ├── handlers/         # HTTP handlers
│   │   └── models/           # Data models
│   ├── pkg/config/           # Configuration
│   └── test_api.sh           # API test script
├── frontend/                  # React Native app
│   └── kitchenai-frontend/
│       ├── App.tsx           # Main app component
│       └── package.json
├── mcp-server/               # MCP Server for LLM integration
│   ├── src/index.ts          # MCP server implementation
│   └── package.json
├── database/                 # Database schema
│   └── schema.sql           # PostgreSQL schema
├── docs/                     # Documentation
└── plan.txt                  # Project requirements and design
```

## 🗄️ Database Schema

### Inventory Table
- `item_id` (UUID) - Primary key
- `canonical_name` (VARCHAR) - Item name
- `qty` (DECIMAL) - Quantity
- `unit` (VARCHAR) - Unit of measurement
- `estimated_expiry` (DATE) - Expiry date
- `is_manual` (BOOLEAN) - Manual entry flag

### User_Prefs Table
- `user_id` (UUID) - Primary key
- `dislikes` (TEXT[]) - Array of disliked foods
- `dietary_tags` (TEXT[]) - Dietary restrictions
- `fav_cuisines` (TEXT[]) - Favorite cuisines

### Cook_Profile Table
- `cook_id` (UUID) - Primary key
- `cook_name` (VARCHAR, optional) - Display name used in WhatsApp draft greetings
- `dishes_known` (TEXT[]) - Array of known dishes
- `preferred_lang` (VARCHAR) - Language for drafted messages (`en`, `hi`, `kn`)
- `phone_number` (VARCHAR) - Cook WhatsApp (E.164, e.g. `+919876543210`) for `wa.me` links
- `user_id` (UUID, optional) - Scopes profile to the logged-in user (see migrations)

## 🚀 Getting Started

### 1. Database Setup

```bash
# Create PostgreSQL database
createdb kitchenai

# Apply schema
psql -d kitchenai -f database/schema.sql
```

After `database/schema.sql`, apply incremental SQL in **`backend/migrations/001_optional_schema.sql`** (user prefs columns, `user_memory`, `shopping_items`, `cook_profile.cook_name`, etc.) on your Postgres instance.

### 2. Backend Setup (Go)

```bash
cd backend

# Install dependencies
go mod download

# Copy backend/.env.example → backend/.env and set DATABASE_URL, LLM keys, GOOGLE_CLIENT_ID, SESSION_TOKEN_SECRET, etc.

# Run API (loads .env from backend directory when present)
go run ./cmd/api
```

### 3. Frontend Setup (React Native)

```bash
cd frontend/kitchenai-frontend

# Install dependencies
npm install

# Start Expo development server
npx expo start
```

### 4. MCP Server Setup

```bash
cd mcp-server

# Install dependencies
npm install

# Build and run
npm run build
npm start
```

## 🔧 API Endpoints

### Inventory Management
- `GET /api/v1/inventory` - Get all inventory items
- `POST /api/v1/inventory` - Create new inventory item
- `GET /api/v1/inventory/{id}` - Get specific item
- `PUT /api/v1/inventory/{id}` - Update item
- `DELETE /api/v1/inventory/{id}` - Delete item
- `GET /api/v1/inventory/expiring` - Get items expiring soon

### Bill scan & meals (auth required)
- `POST /api/v1/bill/scan` - JSON body with base64 image (uses `LLM_PROVIDER`)
- `POST /api/v1/bill/scan/upload` - Multipart bill image
- `GET /api/v1/meals/smart` - Smart meal categories (query: `prompt`, `category`)

### WhatsApp compose (auth required; **no server-side send**)
- `POST /api/v1/whatsapp/send` — returns `{ success, whatsapp_url, body, message }` for arbitrary `phone_number` + `message`
- `POST /api/v1/whatsapp/send-meal-suggestion` — draft to cook from profile; optional `instructions`
- `POST /api/v1/whatsapp/send-daily-menu` — body `{ "menu": [ { "meal_name": "..." } ] }`
- `GET /api/v1/whatsapp/test` — sample compose link + translation smoke test
- `GET /api/v1/whatsapp/cook-info` — masked cook / phone metadata

### User & Cook Management
- `GET /api/v1/user/preferences` - Get user preferences
- `PUT /api/v1/user/preferences` - Update user preferences
- `GET /api/v1/cook/profile` - Get cook profile
- `PUT /api/v1/cook/profile` - Update cook profile

## 🤖 MCP Server Tools

The MCP Server provides the following tools for LLM interaction:

1. **`get_inventory`** - Get all items in inventory
2. **`get_expiring_items`** - Get items expiring within 3 days
3. **`update_stock`** - Update quantity of an item
4. **`add_inventory_item`** - Add new item to inventory
5. **`get_cook_profile`** - Get cook's profile
6. **`get_user_preferences`** - Get user preferences
7. **`suggest_rescue_meal`** - Suggest meal based on expiring items

## 📱 Frontend Features

The React Native app includes:
- Inventory dashboard with expiring items
- Quick actions (Scan Bill, Add Item, Send to Cook)
- Cook profile management
- Real-time inventory tracking
- Meal suggestions based on expiry

## 🧪 Testing

```bash
# Test the Go backend API
cd backend
chmod +x test_api.sh
./test_api.sh
```

## 📅 Development Timeline (6 Weeks)

| Week | Focus | Milestone |
|------|-------|-----------|
| 1 | Foundation | PostgreSQL DB + MCP Server for inventory CRUD |
| 2 | Vision Engine | Bill scanning + shelf-life via configured LLM (Groq or Gemini) |
| 3 | Cook Integration | WhatsApp **draft** links (`wa.me`) from the user's app; cook profile |
| 4 | Reasoning Layer | "Rescue Meal" logic (Expiry + Cook Skills) |
| 5 | Frontend (App) | React Native UI for Android/iOS/Web |
| 6 | Beta Testing | "Human-in-the-loop" testing in Bangalore |

## ✅ Week 2 Implementation: Vision Engine

Week 2 focuses on **multimodal bill scanning** and related parsing, routed through **`LLM_PROVIDER`** (`groq` or `gemini`) — not Gemini-only.

### 🎯 Features Implemented

1. **Gemini AI Integration**
   - Added Google Gemini Go SDK (`github.com/google/generative-ai-go`)
   - Created `GeminiService` in `backend/internal/services/gemini.go`
   - Supports image processing via base64, file upload, or reader
   - Configurable via **`GEMINI_*`** when `LLM_PROVIDER=gemini`, or **`GROQ_*`** when `LLM_PROVIDER=groq` (default)

2. **Bill Scanning Endpoints**
   - `POST /api/v1/bill/scan` - Accepts base64 encoded image
   - `POST /api/v1/bill/scan/upload` - Multipart form file upload
   - `GET /api/v1/bill/scan/test` - Test endpoint with mock data
   - Automatic item extraction and inventory integration

3. **MCP Server Enhancement**
   - Added `scan_bill` tool to MCP server
   - Supports test mode for development
   - Integrates with backend API for real scanning

4. **Frontend UI**
   - Added bill scanning section to React Native app
   - "Scan Bill with AI" button with loading state
   - Results display showing scanned items
   - Automatic inventory refresh after scanning

5. **Image Processing Pipeline**
   - Base64 image decoding
   - MIME type detection and validation
   - Gemini Vision API integration with optimized prompts for Indian grocery bills
   - JSON response parsing with fallback to mock data

### 🛠️ Technical Details

**Gemini Prompt Engineering:**
```text
You are an expert at reading Indian grocery bills. Extract all grocery items from this bill with the following details:
1. Item name (standardized to common Indian grocery names)
2. Quantity (extract the numeric quantity and unit)
3. Price per unit (if available)
4. Total price for that item (if available)

Return the data as a JSON array of objects with these fields: name, quantity, unit, price_per_unit, total_price.

Focus on Indian grocery items like: rice, wheat flour, lentils (dal), vegetables, fruits, spices, oil, milk, etc.
```

**Database Integration:**
- Scanned items are automatically added to inventory
- Existing items have their quantities updated
- Items marked as "auto-scanned" (not manual entry)

### 🚀 Usage

1. **Set Gemini API Key:**
   ```bash
   export GEMINI_API_KEY="your-api-key-here"
   export GEMINI_MODEL="gemini-1.5-pro"
   ```

2. **Test Bill Scanning:**
   ```bash
   curl -X GET http://localhost:8080/api/v1/bill/scan/test
   ```

3. **Scan Real Bill (Base64):**
   ```bash
   curl -X POST http://localhost:8080/api/v1/bill/scan \
     -H "Content-Type: application/json" \
     -d '{"image_data": "base64-encoded-image", "image_type": "image/jpeg"}'
   ```

### 📁 New Files Created

- `backend/internal/services/gemini.go` - Gemini AI service
- `backend/internal/handlers/bill_scan.go` - Bill scanning handlers
- Updated `backend/cmd/api/main.go` - Added bill scanning routes
- Updated `mcp-server/src/index.ts` - Added `scan_bill` tool
- Updated `frontend/kitchenai-frontend/App.tsx` - Added bill scanning UI

## ✅ Week 3 Implementation: Cook integration (WhatsApp compose & translation)

### What the code does today

1. **No Twilio / no WhatsApp Business API in the backend**
   Endpoints build a **`https://wa.me/<digits>?text=…`** link plus plain-text **`body`**. The **Expo app** (or your HTTP client) opens that URL so the **user sends from their own WhatsApp**.

2. **Cook profile** (`GET`/`PUT /api/v1/cook/profile`)
   Stores **`phone_number`** (E.164) and optional **`cook_name`**, plus `dishes_known` and `preferred_lang` for draft wording.

3. **Translation helper** (`TranslationService`)
   Dictionary-based Hindi/Kannada terms; optional **`GOOGLE_TRANSLATE_KEY`** for richer translation elsewhere.

4. **Frontend**
   Cook screen calls the meal-suggestion API, then **`Linking.openURL` / `window.open`** on `whatsapp_url`.

### Example JSON response

```json
{
  "success": true,
  "message": "Open WhatsApp to send to your cook.",
  "body": "Hi Priya,\\n\\nMeal Suggestion: ...",
  "whatsapp_url": "https://wa.me/919876543210?text=..."
}
```

### curl (requires `Authorization: Bearer <jwt>`)

```bash
curl -sS -H "Authorization: Bearer $TOKEN" http://localhost:8080/api/v1/whatsapp/test
```

```bash
curl -sS -X POST http://localhost:8080/api/v1/whatsapp/send-meal-suggestion \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"meal_name":"Paneer Butter Masala","ingredients":[{"name":"Paneer","quantity":200,"unit":"grams"}],"cooking_time":30,"instructions":"Less oil please"}'
```

### Key files

- `backend/internal/services/whatsapp.go` — message templates + `BuildWaMeURL`
- `backend/internal/handlers/whatsapp.go` — HTTP handlers
- `frontend/kitchenai-frontend/src/screens/CookScreen.tsx` — opens `whatsapp_url`

**Inbound replies from the cook** are not implemented yet (would need Cloud API, shared inbox, or a manual capture flow).

## ✅ Week 4 Implementation: Reasoning Layer - Rescue Meal Logic

### 🎯 Features Implemented

1. **Intelligent Meal Suggestion Algorithm**:
   - Combines expiring items, cook skills, and user preferences
   - Priority scoring system (0-100) with multiple factors
   - Indian meal database with 15+ dishes (Paneer Butter Masala, Dal Tadka, Biryani, etc.)

2. **Expiry-Based Prioritization**:
   - Items expiring within 3 days get highest priority
   - Scoring bonus for using multiple expiring items
   - Visual indicators for "Use Today" items

3. **Cook Skill Integration**:
   - Checks if cook can prepare suggested meals
   - Bonus points for meals matching cook's expertise
   - Cook name display for personalized suggestions

4. **User Preference Consideration**:
   - Preferred cuisines (North Indian, South Indian, etc.)
   - Dietary restrictions consideration
   - Personalized meal recommendations

5. **Frontend Rescue Meal UI**:
   - Generate rescue meal suggestions button
   - Visual display of meal cards with priority scores
   - Ingredient lists and cooking times
   - Test endpoints for quick validation

### 🛠️ Technical Details

**Meal Suggestion Service Architecture:**
```go
type MealSuggestionService struct {
    db *sql.DB
}

type RescueMealRequest struct {
    MaxSuggestions int    `json:"max_suggestions"`
    Language       string `json:"language"`
}

type RescueMealResponse struct {
    Suggestions     []MealSuggestion        `json:"suggestions"`
    ExpiringItems   []models.ExpiringItem   `json:"expiring_items"`
    CookSkills      []string                `json:"cook_skills"`
    UserPreferences *models.UserPreferences `json:"user_preferences,omitempty"`
}
```

**Priority Scoring Algorithm:**
1. **Base Score (50 points)**: All meals start with 50 points
2. **Expiry Bonus (up to 30 points)**: +10 for each expiring ingredient used
3. **Cook Skill Bonus (20 points)**: +20 if cook knows how to prepare
4. **User Preference Bonus (15 points)**: +15 if matches preferred cuisine
5. **Cooking Time Bonus (10 points)**: +10 for meals under 30 minutes
6. **Ingredient Match Bonus (5 points each)**: +5 for each additional ingredient match

**Indian Meal Database:**
- 15+ Indian dishes with ingredients and cooking times
- Categorized by cuisine (North Indian, South Indian, Hyderabadi)
- Realistic ingredient lists for accurate matching

### 🚀 Usage

1. **Generate Rescue Meal Suggestions:**
   ```bash
   curl -X GET "http://localhost:8080/api/v1/rescue-meal/suggestions?max_suggestions=3&language=english"
   ```

2. **Get Simple Text Suggestion:**
   ```bash
   curl -X GET http://localhost:8080/api/v1/rescue-meal/simple
   ```

3. **Test Rescue Meal Endpoint:**
   ```bash
   curl -X GET http://localhost:8080/api/v1/rescue-meal/test
   ```

4. **POST Request with Custom Parameters:**
   ```bash
   curl -X POST http://localhost:8080/api/v1/rescue-meal/suggestions \
     -H "Content-Type: application/json" \
     -d '{
       "max_suggestions": 5,
       "language": "hindi"
     }'
   ```

5. **Frontend Integration:**
   - Click "Generate Rescue Meals" button in Week 4 section
   - View meal suggestions with priority scores
   - See which meals the cook can prepare
   - Check ingredient requirements

### 📁 New Files Created (Week 4)

- `backend/internal/services/meal_suggestion.go` - Core meal suggestion service with scoring algorithm
- `backend/internal/handlers/rescue_meal.go` - Rescue meal API handlers
- Updated `backend/cmd/api/main.go` - Added rescue meal routes (`/rescue-meal/suggestions`, `/rescue-meal/simple`, `/rescue-meal/test`)
- Updated `mcp-server/src/index.ts` - Enhanced `suggest_rescue_meal` tool with detailed parameters
- Updated `frontend/kitchenai-frontend/App.tsx` - Added rescue meal UI section with:
  - Generate rescue meals button
  - Meal suggestion cards with scores
  - Ingredient lists and cooking times
  - Test API buttons
- Updated styles for rescue meal components

## ✅ Week 5 Implementation: Intelligent Procurement

### 🎯 Features Implemented

1. **Low Stock Detection**: Automatically identifies items below minimum thresholds for 15+ common Indian kitchen items
2. **Smart Shopping List Generation**: Creates shopping lists based on low stock items and expiring items
3. **Pre-Market Ping**: API returns a **`whatsapp_url`** (and message body) so the user can remind the cook about low stock from their own WhatsApp — same pattern as `/whatsapp/*`.
4. **Procurement Dashboard**: Summary view showing low stock count, expiring items, and recommendations
5. **Shopping List History**: Tracks previously generated shopping lists

### 🛠️ Technical Details

#### Backend Services
- **Procurement Service** (`backend/internal/services/procurement.go`):
  - `GetLowStockItems()`: Detects items below minimum thresholds
  - `GenerateShoppingList()`: Creates smart shopping lists
  - `SendPreMarketPing()`: Builds low-stock text and **WhatsApp compose URL** for the cook
  - `GetProcurementSummary()`: Returns procurement status summary
  - `GetRecentShoppingLists()`: Retrieves shopping list history

- **Low Stock Thresholds**: Pre-defined minimum quantities for common items:
  ```go
  "milk":    {MinQty: 0.5, Unit: "liters", Default: 2.0},
  "tomato":  {MinQty: 3, Unit: "pieces", Default: 10.0},
  "onion":   {MinQty: 2, Unit: "pieces", Default: 5.0},
  "rice":    {MinQty: 0.5, Unit: "kg", Default: 5.0},
  "paneer":  {MinQty: 100, Unit: "grams", Default: 500.0},
  // ... 10+ more items
  ```

#### API Endpoints (Week 5)
- `GET /api/v1/procurement/low-stock` - Get low stock items
- `POST /api/v1/procurement/shopping-list` - Generate shopping list
- `POST /api/v1/procurement/pre-market-ping` - Returns `whatsapp_url` when cook phone is set (auth required)
- `GET /api/v1/procurement/summary` - Get procurement summary
- `GET /api/v1/procurement/recent-lists` - Get recent shopping lists

#### Frontend Integration
- New "Intelligent Procurement" section in App.tsx
- Generate shopping list button with real-time feedback
- Send pre-market ping to cook via WhatsApp
- Display low stock items with priority indicators
- Procurement summary dashboard

### 🚀 Usage

#### 1. Generate Shopping List:
```bash
curl -X POST http://localhost:8080/api/v1/procurement/shopping-list \
  -H "Content-Type: application/json" \
  -d '{
    "include_low_stock": true,
    "include_expiring": true,
    "max_items": 15
  }'
```

#### 2. Get Low Stock Items:
```bash
curl -X GET http://localhost:8080/api/v1/procurement/low-stock
```

#### 3. Pre-market ping (returns `whatsapp_url` in JSON when cook phone exists):
```bash
curl -X POST http://localhost:8080/api/v1/procurement/pre-market-ping \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"language":"en","test_mode":false,"include_all":false}'
```

#### 4. Get Procurement Summary:
```bash
curl -X GET http://localhost:8080/api/v1/procurement/summary
```

#### 5. Frontend Integration:
- Click "Generate Shopping List" button in Week 5 section
- View low stock items with critical/priority indicators
- Send pre-market reminder (opens WhatsApp with draft)
- Check procurement summary dashboard

### 📁 New Files Created (Week 5)

- `backend/internal/services/procurement.go` - Core procurement service with low stock detection and shopping list generation
- `backend/internal/handlers/procurement.go` - Procurement API handlers
- Updated `backend/cmd/api/main.go` - Added procurement routes
- Updated `frontend/kitchenai-frontend/App.tsx` - Added procurement UI section with:
  - Generate shopping list button
  - Send pre-market ping button
  - Low stock items display
  - Shopping list display
  - Procurement summary dashboard
- Updated styles for procurement components

### 🔧 Key Implementation Details

1. **Fallback Mock Data**: Works even without database connection
2. **CORS Support**: Frontend can call API from different origins
3. **Error Handling**: Graceful degradation with informative error messages
4. **Test Mode**: Test endpoints for development and validation
5. **Responsive Design**: Mobile-friendly UI for kitchen use

## 🔮 Future Enhancements

1. **Recipe Database**: Integrate with Indian recipe APIs
2. **Market Integration**: Connect with Zepto/Blinkit APIs
3. **Multi-user Support**: Family member accounts
4. **Analytics Dashboard**: Food waste tracking and insights
5. **Voice Integration**: Voice commands for cooks
6. **Cook reply capture**: Not implemented — future work (WhatsApp Cloud API, shared thread, or manual paste).
7. **Advanced translation**: Broader Google Translate usage where `GOOGLE_TRANSLATE_KEY` is set

## 📄 License

MIT License - See LICENSE file for details

## 👥 Team

Kitchen AI Team - Building intelligent kitchen management for Indian households

## 🔐 Google OAuth Setup (Week 6 - Authentication)

To enable Google OAuth authentication for your Kitchen AI application, follow these steps:

### 1. Create Google OAuth Credentials
1. Go to the [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Navigate to **APIs & Services** → **Credentials**
4. Click **Create Credentials** → **OAuth 2.0 Client ID**
5. Configure the consent screen:
   - Application type: **Web application**
   - Name: "Kitchen AI"
   - Authorized JavaScript origins: e.g. `http://localhost:8082` (Expo web), `http://localhost:19006` (legacy Expo), plus your LAN URL if needed
   - Authorized redirect URIs: `http://localhost:8080/api/v1/auth/google-login` (backend callback)
6. Click **Create** and note your **Client ID**

### 2. Configure Environment Variables
Add the following to your `.env` file in the backend directory:
```
GOOGLE_CLIENT_ID=your_google_client_id_here
SESSION_TOKEN_SECRET=your_session_secret_key_here
DATABASE_URL=postgresql://user:password@host:5432/kitchenai?sslmode=disable
```

### 3. Frontend Integration
The React Native frontend uses `expo-auth-session` (see `src/` screens and `AuthContext`, not only `App.tsx`):
- Uses `expo-auth-session` for Google authentication
- Sends the Google ID token to the backend `/api/v1/auth/google-login` endpoint
- Stores the JWT token for subsequent API requests

### 4. Testing Authentication
1. Start the backend (from `backend/`, with `.env` present):
   ```bash
   cd backend
   go run ./cmd/api
   ```

2. Test the health endpoint:
   ```bash
   curl http://localhost:8080/health
   ```

3. All API endpoints now require authentication via Bearer token

## ✅ Testing Results (Week 6)

### Database Connectivity
- ✅ PostgreSQL database configured via `DATABASE_URL`
- ✅ All 7 tables created successfully (users, inventory, user_prefs, cook_profile, meal_suggestions, shopping_list, auth_sessions)
- ✅ Database schema matches application requirements

### Backend Server
- ✅ Go backend compiles without errors
- ✅ Server starts successfully on port 8080
- ✅ Health endpoint responds correctly
- ✅ CORS configured for frontend (e.g. Expo web on `localhost:8082`)

### Authentication System
- ✅ Google OAuth implementation complete
- ✅ JWT token-based session management
- ✅ Auth middleware protects all API endpoints
- ✅ Session persistence in database

### MCP Server
- ✅ TypeScript compilation successful
- ✅ 10+ tools implemented for AI integration
- ✅ Database connectivity configured

### Frontend
- ✅ React Native/Expo project configured
- ✅ All UI components for Weeks 1-5 implemented
- ✅ API integration ready for authentication

## 🚀 Next Steps

1. **Complete Google OAuth Setup**: Add your Google Client ID to enable login
2. **Test Full Flow**: Create a user via Google login and test inventory management
3. **Deploy Backend**: Deploy to production environment (Render, Railway, or AWS)
4. **Build Mobile App**: Build and publish React Native app to app stores
5. **Monitor & Scale**: Add monitoring, logging, and scaling as user base grows

## 📞 Support

For issues or questions:
1. Check the `SETUP_GUIDE.md` for detailed setup instructions
2. Review database schema in `database/schema.sql`
3. Test API endpoints using the provided test scripts
