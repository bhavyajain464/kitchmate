import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { Platform, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AuthUser } from '../types';
import { googleLogin, logoutApi, setAuthToken } from '../services/api';

const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID!;
const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID!;
const GOOGLE_ANDROID_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID!;

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

// ─── Native: expo-auth-session ───────────────────────────────

function useNativeGoogleAuth(onIdToken: (idToken: string) => void) {
  const [ready, setReady] = useState(false);
  const requestRef = useRef<any>(null);
  const promptAsyncRef = useRef<(() => Promise<any>) | null>(null);

  useEffect(() => {
    if (Platform.OS === 'web') return;

    let mounted = true;

    (async () => {
      const WebBrowser = await import('expo-web-browser');
      const Google = await import('expo-auth-session/providers/google');

      WebBrowser.maybeCompleteAuthSession();

      // We can't use hooks from inside useEffect, so we set up the native
      // auth imperatively on mount. The hook-based approach only works at
      // the top level, so for native we'll trigger promptAsync directly.
      setReady(true);
    })();

    return () => { mounted = false; };
  }, []);

  return { ready };
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
      // GIS handles sign-in via the rendered button; this is a fallback
      const google = (window as any).google;
      if (google?.accounts?.id) {
        google.accounts.id.prompt();
      }
    } else {
      nativeAuth.promptAsync();
    }
  }, [nativeAuth]);

  const signOut = useCallback(async () => {
    try {
      if (token) {
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
      console.error('Logout error:', e);
    }
  }, [token]);

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

  if (Platform.OS === 'web') {
    return { ready: false, promptAsync: () => {} };
  }

  // These imports are safe on native; on web this branch is never reached
  const WebBrowser = require('expo-web-browser');
  const Google = require('expo-auth-session/providers/google');

  WebBrowser.maybeCompleteAuthSession();

  const [request, response, promptAsync] = Google.useAuthRequest({
    clientId: GOOGLE_WEB_CLIENT_ID,
    iosClientId: GOOGLE_IOS_CLIENT_ID,
    androidClientId: GOOGLE_ANDROID_CLIENT_ID,
    webClientId: GOOGLE_WEB_CLIENT_ID,
  });

  useEffect(() => {
    if (response?.type === 'success') {
      const { authentication } = response;
      if (authentication?.idToken) {
        onIdTokenRef.current(authentication.idToken);
      }
    }
  }, [response]);

  return { ready: !!request, promptAsync };
}
