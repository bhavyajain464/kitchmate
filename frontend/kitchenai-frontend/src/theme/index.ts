import { MD3LightTheme, configureFonts } from 'react-native-paper';

const fontConfig = {
  displayLarge: { fontFamily: 'System', fontWeight: '400' as const },
  displayMedium: { fontFamily: 'System', fontWeight: '400' as const },
  displaySmall: { fontFamily: 'System', fontWeight: '400' as const },
  headlineLarge: { fontFamily: 'System', fontWeight: '400' as const },
  headlineMedium: { fontFamily: 'System', fontWeight: '400' as const },
  headlineSmall: { fontFamily: 'System', fontWeight: '400' as const },
  titleLarge: { fontFamily: 'System', fontWeight: '500' as const },
  titleMedium: { fontFamily: 'System', fontWeight: '500' as const },
  titleSmall: { fontFamily: 'System', fontWeight: '500' as const },
  bodyLarge: { fontFamily: 'System', fontWeight: '400' as const },
  bodyMedium: { fontFamily: 'System', fontWeight: '400' as const },
  bodySmall: { fontFamily: 'System', fontWeight: '400' as const },
  labelLarge: { fontFamily: 'System', fontWeight: '500' as const },
  labelMedium: { fontFamily: 'System', fontWeight: '500' as const },
  labelSmall: { fontFamily: 'System', fontWeight: '500' as const },
};

export const theme = {
  ...MD3LightTheme,
  roundness: 12,
  colors: {
    ...MD3LightTheme.colors,
    primary: '#4CAF50',
    primaryContainer: '#C8E6C9',
    secondary: '#2196F3',
    secondaryContainer: '#BBDEFB',
    tertiary: '#FF9800',
    tertiaryContainer: '#FFE0B2',
    error: '#F44336',
    errorContainer: '#FFEBEE',
    background: '#F8F9FA',
    surface: '#FFFFFF',
    surfaceVariant: '#F1F1F1',
    onPrimary: '#FFFFFF',
    onPrimaryContainer: '#1B5E20',
    onSecondary: '#FFFFFF',
    onSecondaryContainer: '#0D47A1',
    onTertiary: '#FFFFFF',
    onTertiaryContainer: '#E65100',
    onSurface: '#1C1B1F',
    onSurfaceVariant: '#666666',
    outline: '#E0E0E0',
    elevation: {
      ...MD3LightTheme.colors.elevation,
      level0: 'transparent',
      level1: '#FFFFFF',
      level2: '#F5F5F5',
      level3: '#EEEEEE',
      level4: '#E0E0E0',
      level5: '#BDBDBD',
    },
  },
  fonts: configureFonts({ config: fontConfig }),
};

export const colors = {
  whatsapp: '#25D366',
  whatsappDark: '#128C7E',
  google: '#4285F4',
  warning: '#FF9800',
  critical: '#F44336',
  success: '#4CAF50',
  scan: '#9C27B0',
  scanLight: '#F3E5F5',
} as const;

// Shared layout constants. `tabBarHeight` must match
// `AppNavigator.styles.tabBar.height` and is consumed by every tab screen to
// size bottom padding consistently.
export const layout = {
  tabBarHeight: 64,
} as const;

export type AppTheme = typeof theme;
