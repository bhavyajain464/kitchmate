import React, { useMemo } from 'react';
import { Image, StyleSheet, View, type FlexAlignType, type StyleProp, type ViewStyle } from 'react-native';
import { Icon } from 'react-native-paper';
import {
  DISH_IMAGE_ASPECT_RATIO,
  getDishImageSource,
  type DishImageVariant,
} from '../data/dishImages';
import { useResolvedDish } from '../hooks/useResolvedDish';

type Props = {
  dishName?: string | null;
  dishId?: string | null;
  variant?: DishImageVariant;
  /** Optional recipe/import image when catalog CDN or bundle is unavailable. */
  imageUrl?: string | null;
  /** Frame width; height is derived from the fixed 3:2 dish ratio. */
  width?: number | `${number}%`;
  borderRadius?: number;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
};

export function DishImage({
  dishName,
  dishId,
  variant = 'card',
  imageUrl,
  width = '100%',
  borderRadius = 12,
  style,
  accessibilityLabel,
}: Props) {
  const { dishId: resolvedId, imageUrls } = useResolvedDish(dishId, dishName);

  const source = useMemo(() => {
    const trimmedUrl = imageUrl?.trim();
    if (trimmedUrl) return { uri: trimmedUrl };
    return getDishImageSource(resolvedId, variant, imageUrls);
  }, [imageUrl, resolvedId, variant, imageUrls]);

  const alignSelf: FlexAlignType = typeof width === 'number' ? 'flex-start' : 'stretch';

  const frameStyle = useMemo(
    () => [
      styles.frame,
      {
        width,
        aspectRatio: DISH_IMAGE_ASPECT_RATIO,
        borderRadius,
        alignSelf,
      },
      style,
    ],
    [width, borderRadius, style, alignSelf],
  );

  if (!source) {
    return (
      <View
        style={[frameStyle, styles.placeholder]}
        accessibilityRole="image"
        accessibilityLabel={accessibilityLabel ?? dishName ?? 'Meal image'}
      >
        <Icon source="silverware-fork-knife" size={28} color="#A5D6A7" />
      </View>
    );
  }

  return (
    <View style={frameStyle} accessibilityRole="image" accessibilityLabel={accessibilityLabel ?? dishName ?? 'Meal photo'}>
      <Image
        source={source}
        style={styles.image}
        resizeMode="contain"
        accessibilityIgnoresInvertColors
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    overflow: 'hidden',
    backgroundColor: '#EEF2EE',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E8F5E9',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#C8E6C9',
  },
});
