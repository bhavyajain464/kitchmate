import type { ImageSourcePropType } from 'react-native';
import { DISH_CARD_IMAGES } from './dishCardImages';
import { getDishImagesCdnBase } from './dishImageConfig';

/** Delivery size variants for photorealistic dish photos (see scripts/optimize-dish-images.mjs). */
export type DishImageVariant = 'hero' | 'card' | 'thumb';

/** Path segment per variant under the CDN / dishes bucket. */
function variantPath(id: string, variant: DishImageVariant): string {
  switch (variant) {
    case 'hero':
      return `${id}.webp`;
    case 'card':
      return `card/${id}.webp`;
    case 'thumb':
      return `thumb/${id}.webp`;
  }
}

/**
 * Remote URL for a catalog dish image using the server-provided CDN base.
 * Returns null when CDN is unset.
 */
export function getDishImageUrl(id: string, variant: DishImageVariant = 'hero'): string | null {
  const CDN_BASE = getDishImagesCdnBase();
  if (!CDN_BASE || !id) return null;
  return `${CDN_BASE}/${variantPath(id, variant)}`;
}

/** Pixel dimensions of each exported variant (3:2). */
export const DISH_IMAGE_SIZES: Record<DishImageVariant, { width: number; height: number }> = {
  hero: { width: 1024, height: 683 },
  card: { width: 512, height: 341 },
  thumb: { width: 256, height: 171 },
};

/** Width ÷ height for all dish delivery assets (landscape 3:2). */
export const DISH_IMAGE_ASPECT_RATIO = DISH_IMAGE_SIZES.card.width / DISH_IMAGE_SIZES.card.height;

/** Resolve bundled or CDN image source for a dish id from the catalog DB. */
export function getDishImageSource(
  dishId?: string | null,
  variant: DishImageVariant = 'card',
  remoteUrls?: Partial<Record<DishImageVariant, string>>,
): ImageSourcePropType | null {
  const id = dishId?.trim();
  if (!id) return null;

  const remoteFromLookup = remoteUrls?.[variant];
  if (remoteFromLookup) return { uri: remoteFromLookup };

  const remote = getDishImageUrl(id, variant);
  if (remote) return { uri: remote };

  const bundled = DISH_CARD_IMAGES[id];
  if (bundled && (variant === 'card' || variant === 'thumb' || variant === 'hero')) {
    return bundled;
  }

  if (variant === 'hero') {
    for (const fallback of ['card', 'thumb'] as const) {
      const remoteFallback = remoteUrls?.[fallback] ?? getDishImageUrl(id, fallback);
      if (remoteFallback) return { uri: remoteFallback };
    }
  }

  return null;
}

/** Best available source for full-screen preview (hero → card → thumb). */
export function getDishPreviewImageSource(
  dishId?: string | null,
  remoteUrls?: Partial<Record<DishImageVariant, string>>,
): ImageSourcePropType | null {
  for (const variant of ['hero', 'card', 'thumb'] as const) {
    const source = getDishImageSource(dishId, variant, remoteUrls);
    if (source) return source;
  }
  return null;
}
