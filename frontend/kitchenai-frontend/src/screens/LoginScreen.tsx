import React from 'react';
import { StyleSheet, View, Platform } from 'react-native';
import { Text, Button, Surface } from 'react-native-paper';
import { StatusBar } from 'expo-status-bar';
import { useAuth } from '../context/AuthContext';
import { colors } from '../theme';

function GoogleButtonWeb() {
  const { googleButtonRef } = useAuth();

  return (
    <View style={styles.gisContainer}>
      {/* Google Identity Services renders its button into this div */}
      <div
        ref={googleButtonRef as any}
        style={{ display: 'flex', justifyContent: 'center', minHeight: 44 }}
      />
    </View>
  );
}

function GoogleButtonNative() {
  const { signIn, loading, ready } = useAuth();

  return (
    <Button
      mode="contained"
      onPress={signIn}
      loading={loading}
      disabled={!ready || loading}
      icon="google"
      style={styles.googleButton}
      contentStyle={styles.googleButtonContent}
      labelStyle={styles.googleButtonLabel}
      buttonColor={colors.google}
    >
      Sign in with Google
    </Button>
  );
}

export function LoginScreen() {
  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <View style={styles.hero}>
        <Text variant="displaySmall" style={styles.logo}>
          Kitchen AI
        </Text>
        <Text variant="bodyLarge" style={styles.tagline}>
          Smart Kitchen Management System
        </Text>
      </View>

      <Surface style={styles.card} elevation={3}>
        <Text variant="headlineSmall" style={styles.title}>
          Welcome
        </Text>
        <Text variant="bodyMedium" style={styles.description}>
          Sign in with your Google account to manage your kitchen inventory, get
          meal suggestions, and communicate with your cook.
        </Text>

        {Platform.OS === 'web' ? <GoogleButtonWeb /> : <GoogleButtonNative />}

        <Text variant="bodySmall" style={styles.note}>
          {Platform.OS === 'web'
            ? 'Sign in securely with your Google account.'
            : "You'll be redirected to Google to sign in securely."}
        </Text>
      </Surface>

      <Text variant="bodySmall" style={styles.footer}>
        Kitchen AI — Bengaluru Edition
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#4CAF50',
    justifyContent: 'center',
    padding: 24,
  },
  hero: {
    alignItems: 'center',
    marginBottom: 40,
  },
  logo: {
    color: '#fff',
    fontWeight: 'bold',
  },
  tagline: {
    color: 'rgba(255,255,255,0.85)',
    marginTop: 8,
  },
  card: {
    borderRadius: 16,
    padding: 28,
    backgroundColor: '#fff',
  },
  title: {
    textAlign: 'center',
    fontWeight: 'bold',
    marginBottom: 12,
  },
  description: {
    textAlign: 'center',
    color: '#666',
    lineHeight: 22,
    marginBottom: 28,
  },
  gisContainer: {
    alignItems: 'center',
    marginBottom: 16,
    minHeight: 50,
  },
  googleButton: {
    borderRadius: 12,
    marginBottom: 16,
  },
  googleButtonContent: {
    paddingVertical: 6,
  },
  googleButtonLabel: {
    fontSize: 16,
    fontWeight: '600',
  },
  note: {
    textAlign: 'center',
    color: '#999',
    fontStyle: 'italic',
  },
  footer: {
    textAlign: 'center',
    color: 'rgba(255,255,255,0.6)',
    marginTop: 32,
  },
});
