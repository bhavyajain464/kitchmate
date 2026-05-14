import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { Platform, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { AuthUser } from '../types';
import { googleLogin, logoutApi, setAuthToken, setOnUnauthorized } from '../services/api';

function getRequiredEnv(value: string | undefined, name: 'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID' | 'EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID' | 'EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID') {
  const trimmedValue = value?.trim();
  if (!trimmedValue) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return trimmedValue;
}

const GOOGLE_WEB_CLIENT_ID = getRequiredEnv(
  process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
  'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID'
);

const GOOGLE_IOS_CLIENT_ID = getRequiredEnv(
  process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
  'EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID'
);

const GOOGLE_ANDROID_CLIENT_ID = getRequiredEnv(
  process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
  'EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID'
);

interface AuthContextType {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  ready: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  /** Web only: ref to a div where Google renders its button */
  googleButtonRef: React.RefObject<HTMLDivElement | null>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  token: null,
  loading: true,
  ready: false,
  signIn: async () => {},
  signOut: async () => {},
  googleButtonRef: { current: null },
});

export function useAuth() {
  return useContext(AuthContext);
}

// ─── Web: Google Identity Services ───────────────────────────

function useGoogleIdentityServices(onCredential: (credential: string) => void) {
  const buttonRef = useRef<HTMLDivElement | null>(null);
  const [ready, setReady] = useState(false);
  const callbackRef = useRef(onCredential);
  callbackRef.current = onCredential;

  useEffect(() => {
    if (Platform.OS !== 'web') return;

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => {
      const google = (window as any).google;
      if (!google?.accounts?.id) return;

      google.accounts.id.initialize({
        client_id: GOOGLE_WEB_CLIENT_ID,
        callback: (response: { credential: string }) => {
          callbackRef.current(response.credential);
        },
      });

      if (buttonRef.current) {
        google.accounts.id.renderButton(buttonRef.current, {
          theme: 'outline',
          size: 'large',
          width: 320,
          text: 'signin_with',
          shape: 'pill',
        });
      }

      setReady(true);
    };
    document.head.appendChild(script);

    return () => {
      document.head.removeChild(script);
    };
  }, []);

  return { buttonRef, ready };
}

// ─── Provider ────────────────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const handleCredential = useCallback(async (credential: string) => {
    try {
      setLoading(true);
      const result = await googleLogin(credential);

      if (result.token && result.user) {
        await AsyncStorage.setItem('authToken', result.token);
        await AsyncStorage.setItem('authUser', JSON.stringify(result.user));
        // Push the token into the api module synchronously so child screens
        // that mount on the next render already have it for their first API
        // call (the token useEffect below runs *after* child effects).
        setAuthToken(result.token);
        setToken(result.token);
        setUser(result.user);
      } else {
        throw new Error('Invalid response from server');
      }
    } catch (e: any) {
      console.error('Google sign-in error:', e);
      if (Platform.OS === 'web') {
        alert('Sign in failed: ' + (e.message || 'Unknown error'));
      } else {
        Alert.alert('Sign In Failed', 'Could not sign in with Google. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Platform-specific hooks
  const webAuth = Platform.OS === 'web'
    ? useGoogleIdentityServices(handleCredential)
    : { buttonRef: { current: null } as React.RefObject<HTMLDivElement | null>, ready: false };

  // For native, we use expo-auth-session hooks at the top level
  const nativeAuth = useNativeAuthRequest(handleCredential);

  useEffect(() => {
    restoreSession();
  }, []);

  useEffect(() => {
    setAuthToken(token);
  }, [token]);

  const restoreSession = async () => {
    try {
      // If the bundle changed since the user's last visit, wipe the stored
      // session once so a stale auth token from an older deploy can't keep
      // them stuck on a broken cached state. The marker is set per-build via
      // EXPO_PUBLIC_BUILD_ID (set on Vercel from VERCEL_GIT_COMMIT_SHA).
      const currentBuild = process.env.EXPO_PUBLIC_BUILD_ID || '';
      if (currentBuild) {
        const lastBuild = await AsyncStorage.getItem('appBuildId');
        if (lastBuild && lastBuild !== currentBuild) {
          await AsyncStorage.multiRemove(['authToken', 'authUser']);
        }
        if (lastBuild !== currentBuild) {
          await AsyncStorage.setItem('appBuildId', currentBuild);
        }
      }

      const storedToken = await AsyncStorage.getItem('authToken');
      const storedUser = await AsyncStorage.getItem('authUser');
      if (storedToken && storedUser) {
        setToken(storedToken);
        setUser(JSON.parse(storedUser));
        setAuthToken(storedToken);
      }
    } catch (e) {
      console.error('Error restoring session:', e);
    } finally {
      setLoading(false);
    }
  };

  const signIn = useCallback(async () => {
    if (Platform.OS === 'web') {
      // GIS handles sign-in via the rendered button; this triggers the prompt explicitly.
      const google = (window as any).google;
      if (google?.accounts?.id) {
        google.accounts.id.prompt();
      }
    } else {
      nativeAuth.promptAsync();
    }
  }, [nativeAuth]);

  const clearSession = useCallback(async (opts?: { skipServerLogout?: boolean }) => {
    try {
      if (token && !opts?.skipServerLogout) {
        await logoutApi(token).catch(() => {});
      }
      await AsyncStorage.multiRemove(['authToken', 'authUser']);
      setToken(null);
      setUser(null);
      setAuthToken(null);

      if (Platform.OS === 'web') {
        const google = (window as any).google;
        google?.accounts?.id?.disableAutoSelect();
      }
    } catch (e) {
      console.error('Clear session error:', e);
    }
  }, [token]);

  const signOut = useCallback(async () => {
    await clearSession();
  }, [clearSession]);

  useEffect(() => {
    setOnUnauthorized(() => {
      // Server invalidated our token (expired, revoked, restart). Drop the
      // local session immediately so screens stop showing "0" everywhere and
      // the navigator routes back to Login on the next render.
      clearSession({ skipServerLogout: true });
      if (Platform.OS === 'web') {
        try {
          if (typeof window !== 'undefined') {
            window.alert('Your session has expired. Please sign in again.');
          }
        } catch {}
      } else {
        Alert.alert('Session expired', 'Please sign in again to continue.');
      }
    });
    return () => setOnUnauthorized(null);
  }, [clearSession]);

  const ready = Platform.OS === 'web' ? webAuth.ready : nativeAuth.ready;

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        loading,
        ready,
        signIn,
        signOut,
        googleButtonRef: webAuth.buttonRef as React.RefObject<HTMLDivElement | null>,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// ─── Native auth hook (must be called at top level) ──────────

function useNativeAuthRequest(onIdToken: (idToken: string) => void) {
  const onIdTokenRef = useRef(onIdToken);
  onIdTokenRef.current = onIdToken;
  const [ready, setReady] = useState(false);

  if (Platform.OS === 'web') {
    return { ready: false, promptAsync: () => {} };
  }

  useEffect(() => {
    GoogleSignin.configure({
      webClientId: GOOGLE_WEB_CLIENT_ID,
      iosClientId: Platform.OS === 'ios' ? GOOGLE_IOS_CLIENT_ID : undefined,
      offlineAccess: false,
      profileImageSize: 120,
    });
    setReady(true);
  }, []);

  const promptAsync = useCallback(async () => {
    if (Platform.OS === 'android') {
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    }

    const response = await GoogleSignin.signIn();
    if (response.type !== 'success') {
      return;
    }

    const idToken = response.data.idToken;
    if (!idToken) {
      throw new Error('Google sign-in did not return an ID token');
    }

    await onIdTokenRef.current(idToken);
  }, []);

  return {
    ready,
    promptAsync: () => promptAsync(),
  };
}
