import React, { useEffect, useState } from 'react';
import { Platform, ActivityIndicator, View, StyleSheet, StatusBar as RNStatusBar } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { PaperProvider } from 'react-native-paper';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { I18nextProvider } from 'react-i18next';
import { AuthProvider } from './src/context/AuthContext';
import { AppFeedbackProvider } from './src/context/AppFeedbackContext';
import { PaymentCheckoutProvider } from './src/context/PaymentCheckoutContext';
import { LocaleProvider } from './src/context/LocaleContext';
import { AppNavigator } from './src/navigation/AppNavigator';
import { theme } from './src/theme';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/react';
import i18n, { initI18n } from './src/i18n';

function AppBootScreen() {
  return (
    <View style={styles.boot}>
      <ActivityIndicator size="large" color="#2E7D32" />
    </View>
  );
}

function AppTree() {
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    RNStatusBar.setBarStyle('dark-content');
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        {Platform.OS === 'ios' ? <StatusBar style="dark" /> : null}
        <PaperProvider theme={theme}>
          <AppFeedbackProvider>
            <PaymentCheckoutProvider>
              <LocaleProvider>
                <AuthProvider>
                  <AppNavigator />
                  {Platform.OS === 'web' && (
                    <>
                      <Analytics />
                      <SpeedInsights />
                    </>
                  )}
                </AuthProvider>
              </LocaleProvider>
            </PaymentCheckoutProvider>
          </AppFeedbackProvider>
        </PaperProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

export default function App() {
  const [i18nReady, setI18nReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void initI18n().then(() => {
      if (!cancelled) setI18nReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!i18nReady) {
    return <AppBootScreen />;
  }

  return (
    <I18nextProvider i18n={i18n}>
      <AppTree />
    </I18nextProvider>
  );
}

const styles = StyleSheet.create({
  boot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FAFAFA',
  },
});
