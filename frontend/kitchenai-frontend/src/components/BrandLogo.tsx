import React from 'react';
import { ImageStyle, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { OptimizedImage } from './OptimizedImage';
import { brandLogo, BRAND_DISPLAY_NAME, BRAND_HEADER_BG } from '../constants/brand';

type BrandLogoProps = {
  width?: number;
  height?: number;
  style?: StyleProp<ViewStyle>;
  imageStyle?: StyleProp<ImageStyle>;
  /** Login header: paint same matte behind image (avoids scaling fringe). */
  onHeaderMatte?: boolean;
};

/** Full Rasoi Buddy logo (chef + cart + wordmark). */
export function BrandLogo({
  width = 280,
  height = 218,
  style,
  imageStyle,
  onHeaderMatte = false,
}: BrandLogoProps) {
  const matte = onHeaderMatte ? { backgroundColor: BRAND_HEADER_BG } : null;

  return (
    <View style={[styles.wrap, matte, { width, height }, style]}>
      <OptimizedImage
        source={brandLogo}
        style={[styles.image, matte, { width, height }, imageStyle]}
        resizeMode="contain"
        accessibilityRole="image"
        accessibilityLabel={`${BRAND_DISPLAY_NAME} logo`}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  image: {
    width: '100%',
    height: '100%',
  },
});
