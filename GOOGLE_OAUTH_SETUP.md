# Google OAuth Multi-Platform Setup Guide

This guide explains how to configure Google OAuth for multi-platform support (Web, iOS, Android) in the KitchenAI application.

## Ports and env (current app)

- **Backend API**: `http://localhost:8080` (or your deployed URL). Paths live under `/api/v1`.
- **Expo web dev** often runs on **`http://localhost:8082`** — add that origin and matching **Authorized redirect URI** in the Google Cloud **Web client** if you use Expo web.
- Frontend secrets live in **`frontend/kitchenai-frontend/.env`** (`EXPO_PUBLIC_*`). Backend uses **`backend/.env`** for `GOOGLE_CLIENT_ID` (server token verification) and `SESSION_TOKEN_SECRET`.

## Current Configuration

- **Machine IP**: 192.168.0.116
- **Backend Port**: 8080
- **Expo Dev Server Port**: 8082
- **iOS Client ID**: `208103249970-5j9v2282v0f9r0d8859shqmnurpc93lp.apps.googleusercontent.com` (already configured as iOS client)

## Step 1: Create Three OAuth 2.0 Client IDs

Go to [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials

### 1. Web Application Client
- **Type**: Web application
- **Name**: `kitchenai-web-client`
- **Authorized JavaScript origins**:
  - `http://localhost:8082` (Expo web, common local default)
  - `http://localhost:19006`
  - `http://192.168.0.116:19006`
  - `http://localhost:3000`
- **Authorized redirect URIs**:
  - `http://localhost:8082`
  - `http://localhost:19006`
  - `http://192.168.0.116:19006`
  - `http://localhost:3000`
- **Client ID**: Copy this value for `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`

### 2. iOS Application Client
- **Type**: iOS application
- **Name**: `kitchenai-ios-client`
- **Bundle ID**: Get from `app.json` (currently not specified, needs to be set)
- **Client ID**: Already exists as `208103249970-5j9v2282v0f9r0d8859shqmnurpc93lp.apps.googleusercontent.com`
- **URL scheme**: `exp://192.168.0.116:8082`

### 3. Android Application Client
- **Type**: Android application
- **Name**: `kitchenai-android-client`
- **Package name**: Get from `app.json` (currently not specified, needs to be set)
- **SHA-1 fingerprint**: Generate using:
  ```bash
  keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android -keypass android
  ```
- **Client ID**: Copy this value for `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID`

## Step 2: Update Environment Variables

Update `frontend/kitchenai-frontend/.env` with the actual client IDs:

```env
# Google OAuth Client IDs for multi-platform support
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=YOUR_WEB_CLIENT_ID_HERE
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=208103249970-5j9v2282v0f9r0d8859shqmnurpc93lp.apps.googleusercontent.com
EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID=YOUR_ANDROID_CLIENT_ID_HERE

# Redirect URIs
EXPO_PUBLIC_WEB_REDIRECT_URI=http://localhost:19006
EXPO_PUBLIC_IOS_REDIRECT_URI=exp://192.168.0.116:8082
EXPO_PUBLIC_ANDROID_REDIRECT_URI=exp://192.168.0.116:8082
```

## Step 3: Update App Configuration

Update `frontend/kitchenai-frontend/app.json` with proper bundle ID and package name:

```json
{
  "expo": {
    "name": "kitchenai-frontend",
    "slug": "kitchenai-frontend",
    "version": "1.0.0",
    "orientation": "portrait",
    "icon": "./assets/icon.png",
    "userInterfaceStyle": "light",
    "newArchEnabled": true,
    "splash": {
      "image": "./assets/splash-icon.png",
      "resizeMode": "contain",
      "backgroundColor": "#ffffff"
    },
    "ios": {
      "supportsTablet": true,
      "bundleIdentifier": "com.yourcompany.kitchenai"
    },
    "android": {
      "adaptiveIcon": {
        "foregroundImage": "./assets/adaptive-icon.png",
        "backgroundColor": "#ffffff"
      },
      "edgeToEdgeEnabled": true,
      "predictiveBackGestureEnabled": false,
      "package": "com.yourcompany.kitchenai"
    },
    "web": {
      "favicon": "./assets/favicon.png"
    }
  }
}
```

## Step 4: Configure Backend CORS

The backend CORS configuration in `backend/cmd/api/main.go` already includes:
- `http://localhost:19006`
- `http://192.168.0.116:19006`
- `http://192.168.0.116:8082`
- `exp://192.168.0.116:8082`

## Step 5: Test the Configuration

1. Restart the backend server:
   ```bash
   cd backend && DATABASE_URL="postgresql://kitch_admin:kitch@140.245.26.151:5432/kitch-mate?sslmode=disable" GOOGLE_CLIENT_ID="208103249970-5j9v2282v0f9r0d8859shqmnurpc93lp.apps.googleusercontent.com" go run cmd/api/main.go
   ```

2. Start the Expo dev server:
   ```bash
   cd frontend/kitchenai-frontend && npx expo start --port 8082
   ```

3. Scan the QR code with Expo Go app on your iOS device.

4. Test Google Sign-In button in the app.

## Troubleshooting

### Common Issues

1. **"redirect_uri mismatch" error**:
   - Ensure the redirect URI in Google Cloud Console matches exactly what Expo is using
   - For iOS: `exp://192.168.0.116:8082`
   - For Web: `http://localhost:19006` or `http://192.168.0.116:19006`

2. **CORS errors**:
   - Check that the backend CORS configuration includes all necessary origins
   - Restart the backend after making changes

3. **Client ID not working**:
   - Ensure you're using the correct client ID type for each platform
   - Web client ID for web platform
   - iOS client ID for iOS platform
   - Android client ID for Android platform

## Notes

- The current iOS client ID (`208103249970-5j9v2282v0f9r0d8859shqmnurpc93lp.apps.googleusercontent.com`) is configured as an iOS client but is being used as a web client in the code. This causes the redirect_uri mismatch error.
- For production, you should use proper bundle IDs and package names.
- Consider using Expo Application Services (EAS) for building and distributing the app.