import React from 'react';
import { StyleSheet, View, Platform } from 'react-native';
import { Text, Button, Surface, IconButton } from 'react-native-paper';
import { StatusBar } from 'expo-status-bar';
import { useAuth } from '../context/AuthContext';
import { colors } from '../theme';

function GoogleButtonWeb() {
  const { googleButtonRef } = useAuth();

  return (
    <View style={styles.gisContainer}>
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

      {/* Background decoration */}
      <View style={styles.bgCircle1} />
      <View style={styles.bgCircle2} />

      <View style={styles.content}>
        {/* Logo */}
        <View style={styles.logoWrap}>
          <Surface style={styles.logoCircle} elevation={3}>
            <IconButton icon="silverware-fork-knife" iconColor="#4CAF50" size={36} style={{ margin: 0 }} />
          </Surface>
        </View>

        <Text variant="headlineMedium" style={styles.appName}>Kitchen AI</Text>
        <Text variant="bodyMedium" style={styles.tagline}>
          Smart Kitchen Management
        </Text>

        {/* Features */}
        <View style={styles.features}>
          {[
            { icon: 'package-variant', text: 'Track inventory & expiry' },
            { icon: 'silverware-fork-knife', text: 'AI-powered meal ideas' },
            { icon: 'cart-outline', text: 'Smart shopping lists' },
          ].map((f, i) => (
            <View key={i} style={styles.featureRow}>
              <View style={styles.featureDot}>
                <IconButton icon={f.icon} iconColor="#fff" size={16} style={{ margin: 0 }} />
              </View>
              <Text style={styles.featureText}>{f.text}</Text>
            </View>
          ))}
        </View>

        {/* Login card */}
        <Surface style={styles.card} elevation={4}>
          <Text variant="titleLarge" style={styles.cardTitle}>Welcome</Text>
          <Text variant="bodyMedium" style={styles.cardDesc}>
            Sign in to manage your kitchen, get personalized meal suggestions, and communicate with your cook.
          </Text>

          {Platform.OS === 'web' ? <GoogleButtonWeb /> : <GoogleButtonNative />}

          <Text variant="bodySmall" style={styles.note}>
            Secured with Google Authentication
          </Text>
        </Surface>

        <Text variant="bodySmall" style={styles.footer}>
          Kitchen AI — Bengaluru Edition
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#388E3C',
    overflow: 'hidden',
  },
  bgCircle1: {
    position: 'absolute',
    top: -80,
    right: -60,
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  bgCircle2: {
    position: 'absolute',
    bottom: -100,
    left: -80,
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },

  logoWrap: { alignItems: 'center', marginBottom: 16 },
  logoCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  appName: {
    color: '#fff',
    fontWeight: '800',
    textAlign: 'center',
  },
  tagline: {
    color: 'rgba(255,255,255,0.8)',
    textAlign: 'center',
    marginTop: 4,
  },

  features: {
    marginTop: 28,
    marginBottom: 28,
    gap: 12,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  featureDot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  featureText: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 15,
    fontWeight: '500',
  },

  card: {
    borderRadius: 20,
    padding: 28,
    backgroundColor: '#fff',
  },
  cardTitle: {
    textAlign: 'center',
    fontWeight: '700',
    color: '#333',
    marginBottom: 8,
  },
  cardDesc: {
    textAlign: 'center',
    color: '#888',
    lineHeight: 22,
    marginBottom: 24,
  },
  gisContainer: {
    alignItems: 'center',
    marginBottom: 16,
    minHeight: 50,
  },
  googleButton: {
    borderRadius: 14,
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
    color: '#bbb',
  },

  footer: {
    textAlign: 'center',
    color: 'rgba(255,255,255,0.5)',
    marginTop: 28,
  },
});
