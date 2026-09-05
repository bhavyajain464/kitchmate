import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { Platform } from 'react-native';
import { showAppError, showAppInfo } from '../utils/alertMessage';
import { userFacingError } from '../utils/userFacingError';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import { AuthUser } from '../types';
import { googleLogin, logoutApi, setAuthToken, setOnUnauthorized } from '../services/api';
import { clearOrderSuggestionsCache } from '../utils/orderSuggestionsCache';
import { resetWebAppHomePath, resetWebPublicPath } from '../navigation/webHomePath';
import { isAdminWebPath } from '../navigation/adminPath';
import { BRAND_DISPLAY_NAME } from '../constants/brand';
import { syncPushTokenWithBackend, clearPushTokenFromBackend } from '../services/marketingPush';

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
  /** Web: true after GIS renderButton succeeds (false → show fallback) */
  googleButtonRendered: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  /** Web only: callback ref for the div where Google renders its button */
  setGoogleButtonRef: (node: HTMLDivElement | null) => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  token: null,
  loading: true,
  ready: false,
  googleButtonRendered: false,
  signIn: async () => {},
  signOut: async () => {},
  setGoogleButtonRef: () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

// ─── Web: Google Identity Services ───────────────────────────

const GSI_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';

function useGoogleIdentityServices(onCredential: (credential: string) => void) {
  const buttonRef = useRef<HTMLDivElement | null>(null);
  const [gisReady, setGisReady] = useState(false);
  const [buttonRendered, setButtonRendered] = useState(false);
  const callbackRef = useRef(onCredential);
  callbackRef.current = onCredential;
  const initializedRef = useRef(false);

  const initializeGis = useCallback(() => {
    const google = (window as any).google;
    if (!google?.accounts?.id || initializedRef.current) {
      return !!google?.accounts?.id;
    }
    google.accounts.id.initialize({
      client_id: GOOGLE_WEB_CLIENT_ID,
      callback: (response: { credential: string }) => {
        callbackRef.current(response.credential);
      },
      // FedCM avoids popup/postMessage paths blocked by strict COOP on some hosts.
      use_fedcm_for_prompt: true,
    });
    initializedRef.current = true;
    setGisReady(true);
    return true;
  }, []);

  const renderGoogleButton = useCallback(() => {
    if (!gisReady || !buttonRef.current) {
      return false;
    }
    const google = (window as any).google;
    if (!google?.accounts?.id) {
      return false;
    }
    try {
      buttonRef.current.innerHTML = '';
      google.accounts.id.renderButton(buttonRef.current, {
        theme: 'outline',
        size: 'large',
        width: 320,
        text: 'signin_with',
        shape: 'pill',
      });
      const hasButton = buttonRef.current.childElementCount > 0;
      setButtonRendered(hasButton);
      return hasButton;
    } catch (e) {
      console.error('GIS renderButton failed:', e);
      setButtonRendered(false);
      return false;
    }
  }, [gisReady]);

  // Load GIS script once (do not remove on unmount — breaks remount / strict mode).
  useEffect(() => {
    if (Platform.OS !== 'web') return;

    if ((window as any).google?.accounts?.id) {
      initializeGis();
      return;
    }

    const existing = document.querySelector(`script[src="${GSI_SCRIPT_SRC}"]`);
    if (existing) {
      const onReady = () => initializeGis();
      existing.addEventListener('load', onReady);
      if ((window as any).google?.accounts?.id) {
        onReady();
      }
      return () => existing.removeEventListener('load', onReady);
    }

    const script = document.createElement('script');
    script.src = GSI_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => initializeGis();
    script.onerror = () => console.error('Failed to load Google Identity Services');
    document.head.appendChild(script);
  }, [initializeGis]);

  // Re-render when GIS becomes ready (login div may mount later than script onload).
  useEffect(() => {
    if (!gisReady) return;
    renderGoogleButton();
  }, [gisReady, renderGoogleButton]);

  const setGoogleButtonRef = useCallback(
    (node: HTMLDivElement | null) => {
      buttonRef.current = node;
      if (node && gisReady) {
        requestAnimationFrame(() => renderGoogleButton());
      }
    },
    [gisReady, renderGoogleButton]
  );

  return { setGoogleButtonRef, ready: gisReady, buttonRendered };
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
        if (Platform.OS !== 'web' || !isAdminWebPath()) {
          resetWebAppHomePath();
        }
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
    } catch (e: unknown) {
      console.error('Google sign-in error:', e);
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('Network request failed') || msg.includes('Failed to fetch')) {
        showAppError(`Cannot reach ${BRAND_DISPLAY_NAME} servers. Check your internet connection.`);
      } else if (msg.includes('401') || msg.includes('invalid audience') || msg.includes('verification failed')) {
        showAppError('Server rejected this Google account. Contact support if this persists.');
      } else {
        showAppError(userFacingError(e, 'Could not sign in. Please try again.'));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const webAuth = useGoogleIdentityServices(handleCredential);
  const nativeAuth = useNativeAuthRequest(handleCredential);

  useEffect(() => {
    restoreSession();
  }, []);

  useEffect(() => {
    setAuthToken(token);
  }, [token]);

  useEffect(() => {
    if (!token) return;
    void syncPushTokenWithBackend();
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
      await nativeAuth.promptAsync();
    }
  }, [nativeAuth]);

  const clearSession = useCallback(async (opts?: { skipServerLogout?: boolean }) => {
    try {
      await clearPushTokenFromBackend();
      if (token && !opts?.skipServerLogout) {
        await logoutApi(token).catch(() => {});
      }
      await AsyncStorage.multiRemove(['authToken', 'authUser']);
      await clearOrderSuggestionsCache();
      resetWebPublicPath();
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
      showAppInfo('Your session has expired. Please sign in again.');
    });
    return () => setOnUnauthorized(null);
  }, [clearSession]);

  const ready = Platform.OS === 'web' ? webAuth.ready : nativeAuth.ready;
  const googleButtonRendered = Platform.OS === 'web' ? webAuth.buttonRendered : true;

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        loading,
        ready,
        googleButtonRendered,
        signIn,
        signOut,
        setGoogleButtonRef: webAuth.setGoogleButtonRef,
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

  useEffect(() => {
    if (Platform.OS === 'web') return;
    GoogleSignin.configure({
      webClientId: GOOGLE_WEB_CLIENT_ID,
      iosClientId: Platform.OS === 'ios' ? GOOGLE_IOS_CLIENT_ID : undefined,
      offlineAccess: false,
      profileImageSize: 120,
    });
    setReady(true);
  }, []);

  const promptAsync = useCallback(async () => {
    if (Platform.OS === 'web') return;
    try {
      if (Platform.OS === 'android') {
        await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      }

      const response = await GoogleSignin.signIn();
      if (response.type !== 'success') {
        return;
      }

      const idToken = response.data.idToken;
      if (!idToken) {
        throw new Error('Google did not return an ID token. Use a Web client ID as webClientId in Google Cloud.');
      }

      await onIdTokenRef.current(idToken);
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string };
      const code = err?.code;
      const msg = err?.message ?? (e instanceof Error ? e.message : String(e));

      if (code === statusCodes.SIGN_IN_CANCELLED) {
        return;
      }
      if (code === statusCodes.IN_PROGRESS) {
        showAppInfo('Sign-in already in progress.');
        return;
      }
      if (code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        showAppError('Google Play Services is missing or outdated on this device.');
        return;
      }
      if (msg.includes('DEVELOPER_ERROR') || code === '10') {
        showAppError('Google sign-in failed. Please try again.');
        return;
      }

      console.error('Native Google sign-in error:', e);
      showAppError(userFacingError(e, 'Google sign-in failed.'));
    }
  }, []);

  return {
    ready: Platform.OS === 'web' ? false : ready,
    promptAsync: () => promptAsync(),
  };
}
