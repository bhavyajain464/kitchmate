import React from 'react';
import { Image, Platform, type ImageProps } from 'react-native';

type Props = ImageProps & {
  /** Use Android subsampling when the decoded bitmap is larger than the view. */
  optimizeBitmap?: boolean;
};

/**
 * Thin Image wrapper that enables Fresco resize-on-decode for Android thumbnails.
 * Play Console flags apps that decode full-size bitmaps into small views.
 */
export function OptimizedImage({ optimizeBitmap = true, ...props }: Props) {
  const androidResize =
    Platform.OS === 'android' && optimizeBitmap ? ({ resizeMethod: 'resize' } as const) : null;

  return <Image {...androidResize} {...props} />;
}
