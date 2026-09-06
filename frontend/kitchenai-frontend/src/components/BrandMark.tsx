import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { OptimizedImage } from './OptimizedImage';
import { brandIconMark } from '../constants/brand';

/** Matches landing-page nav: green glow + icon-mark + “Rasoi Buddy” wordmark. */
export function BrandMark({
  compact = true,
  style,
}: {
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const markSize = compact ? 40 : 72;
  const glowSize = compact ? 30 : 46;
  const iconRadius = compact ? 9 : 11;
  const fontSize = compact ? 20 : 28;

  return (
    <View style={[styles.row, style]} accessibilityRole="header">
      <View style={[styles.mark, { width: markSize, height: markSize }]}>
        <View
          style={[
            styles.glow,
            {
              width: glowSize,
              height: glowSize,
              borderRadius: iconRadius,
            },
          ]}
        />
        <OptimizedImage
          source={brandIconMark}
          style={[
            styles.icon,
            {
              width: markSize,
              height: markSize,
              borderRadius: iconRadius,
            },
          ]}
          accessibilityIgnoresInvertColors
          accessibilityLabel=""
        />
      </View>
      <Text style={[styles.name, { fontSize, lineHeight: markSize }]}>
        Rasoi <Text style={styles.nameAccent}>Buddy</Text>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  mark: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  glow: {
    position: 'absolute',
    backgroundColor: '#1fb562',
    shadowColor: '#15803d',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.45,
    shadowRadius: 7,
    elevation: 4,
  },
  icon: {
    position: 'relative',
    zIndex: 1,
    backgroundColor: '#ffffff',
  },
  name: {
    fontWeight: '800',
    color: '#0c1611',
    letterSpacing: -0.4,
  },
  nameAccent: {
    color: '#15803d',
  },
});
