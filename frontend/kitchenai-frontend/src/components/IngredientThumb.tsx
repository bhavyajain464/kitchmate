import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Icon } from 'react-native-paper';
import { OptimizedImage } from './OptimizedImage';
import { getIngredientStapleImageSource } from '../data/ingredientImages';

type Props = {
  name: string;
  ingredientId?: string | null;
  size?: number;
  resizeMode?: 'cover' | 'contain';
};

export function IngredientThumb({ name, ingredientId, size = 40, resizeMode = 'cover' }: Props) {
  const source = useMemo(
    () => getIngredientStapleImageSource(name, ingredientId?.trim() || undefined),
    [ingredientId, name],
  );

  const frameStyle = useMemo(
    () => [styles.frame, { width: size, height: size, borderRadius: Math.round(size * 0.24) }],
    [size],
  );

  if (source) {
    return (
      <OptimizedImage
        source={source}
        style={frameStyle}
        resizeMode={resizeMode}
        accessibilityIgnoresInvertColors
      />
    );
  }

  return (
    <View style={[frameStyle, styles.placeholder]} accessibilityRole="image">
      <Icon source="food-apple" size={Math.round(size * 0.45)} color="#81C784" />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    overflow: 'hidden',
    backgroundColor: '#F3F4F2',
    flexShrink: 0,
  },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E0E8E0',
  },
});
