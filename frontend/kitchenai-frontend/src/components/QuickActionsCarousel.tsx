import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  StyleSheet,
  View,
  ScrollView,
  Pressable,
  useWindowDimensions,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { Surface, Text, IconButton, Icon } from 'react-native-paper';
import { useWhatsAppShare } from './WhatsAppShareHandler';

const H_PAD = 24;
const GAP = 10;
const ACTION_CARD_HEIGHT = 92;
const MIN_CARD_WIDTH = ACTION_CARD_HEIGHT;
const ACTION_COUNT = 5;
const ARROW_SIZE = 26;
const ARROW_GUTTER = ARROW_SIZE + 4;

type QuickActionsCarouselProps = {
  onAddItem: () => void;
  onMealIdea: () => void;
  onLogMeal: () => void;
  onAddToList: () => void;
};

function ActionSlide({
  icon,
  label,
  onPress,
  width,
}: {
  icon: string;
  label: string;
  onPress: () => void;
  width: number;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        { width, height: ACTION_CARD_HEIGHT, opacity: pressed ? 0.88 : 1 },
      ]}
    >
      <Surface
        style={[styles.actionSurface, { width, height: ACTION_CARD_HEIGHT }]}
        elevation={0}
      >
        <View style={styles.actionIconWrap}>
          <IconButton icon={icon} iconColor="#2E7D32" size={22} style={{ margin: 0 }} />
        </View>
        <Text variant="labelMedium" style={styles.actionLabel} numberOfLines={2}>
          {label}
        </Text>
      </Surface>
    </Pressable>
  );
}

function CarouselScrollArrow({
  direction,
  onPress,
  visible,
}: {
  direction: 'left' | 'right';
  onPress: () => void;
  visible: boolean;
}) {
  if (!visible) {
    return null;
  }

  const icon = direction === 'left' ? 'chevron-left' : 'chevron-right';
  const label =
    direction === 'left' ? 'Scroll quick actions left' : 'Scroll quick actions right';

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.arrowHit,
        direction === 'left' ? styles.arrowHitLeft : styles.arrowHitRight,
        pressed && styles.arrowHitPressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View style={styles.arrowCircle}>
        <Icon source={icon} size={16} color="#7CB342" />
      </View>
    </Pressable>
  );
}

function useQuickActionLayout(screenWidth: number) {
  return useMemo(() => {
    const frameWidth = screenWidth - H_PAD * 2;
    const ideal = (frameWidth - (ACTION_COUNT - 1) * GAP) / ACTION_COUNT;
    const cardWidth = Math.max(MIN_CARD_WIDTH, Math.floor(ideal));
    const rowWidth = ACTION_COUNT * cardWidth + (ACTION_COUNT - 1) * GAP;
    const scrollable = rowWidth > frameWidth + 1;
    const snapInterval = cardWidth + GAP;

    return { cardWidth, scrollable, snapInterval, frameWidth };
  }, [screenWidth]);
}

export function QuickActionsCarousel({
  onAddItem,
  onMealIdea,
  onLogMeal,
  onAddToList,
}: QuickActionsCarouselProps) {
  const { t } = useTranslation();
  const { width: screenWidth } = useWindowDimensions();
  const { openCompose } = useWhatsAppShare();
  const { cardWidth, scrollable, snapInterval, frameWidth } =
    useQuickActionLayout(screenWidth);
  const scrollRef = useRef<ScrollView>(null);
  const scrollXRef = useRef(0);
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(scrollable);

  useEffect(() => {
    if (!scrollable) {
      setShowLeftArrow(false);
      setShowRightArrow(false);
      return;
    }
    setShowRightArrow(true);
    setShowLeftArrow(false);
  }, [scrollable]);

  const updateArrowVisibility = useCallback(
    (x: number, content: number) => {
      if (!scrollable) {
        setShowLeftArrow(false);
        setShowRightArrow(false);
        return;
      }
      if (content <= 0) {
        setShowLeftArrow(false);
        setShowRightArrow(true);
        return;
      }
      setShowLeftArrow(x > 4);
      setShowRightArrow(x < content - frameWidth - 4);
    },
    [scrollable, frameWidth],
  );

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const x = e.nativeEvent.contentOffset.x;
      scrollXRef.current = x;
      updateArrowVisibility(x, e.nativeEvent.contentSize.width);
    },
    [updateArrowVisibility],
  );

  const scrollNext = useCallback(() => {
    const nextX = scrollXRef.current + snapInterval;
    scrollRef.current?.scrollTo({ x: nextX, animated: true });
  }, [snapInterval]);

  const scrollPrev = useCallback(() => {
    const prevX = Math.max(0, scrollXRef.current - snapInterval);
    scrollRef.current?.scrollTo({ x: prevX, animated: true });
  }, [snapInterval]);

  const slides = (
    <>
      <ActionSlide
        icon="robot-outline"
        label={t('quickActions.aiBuddy')}
        onPress={openCompose}
        width={cardWidth}
      />
      <ActionSlide icon="plus-box-outline" label={t('quickActions.addItem')} onPress={onAddItem} width={cardWidth} />
      <ActionSlide icon="lightbulb-on-outline" label={t('quickActions.mealIdea')} onPress={onMealIdea} width={cardWidth} />
      <ActionSlide icon="notebook-plus-outline" label={t('quickActions.logMeal')} onPress={onLogMeal} width={cardWidth} />
      <ActionSlide icon="cart-plus" label={t('quickActions.addToList')} onPress={onAddToList} width={cardWidth} />
    </>
  );

  if (scrollable) {
    return (
      <View style={styles.wrap}>
        <View style={[styles.carouselFrame, { width: frameWidth, height: ACTION_CARD_HEIGHT }]}>
          <ScrollView
            ref={scrollRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            decelerationRate="fast"
            snapToInterval={snapInterval}
            snapToAlignment="start"
            nestedScrollEnabled
            scrollEventThrottle={16}
            onScroll={onScroll}
            onContentSizeChange={(w) => updateArrowVisibility(scrollXRef.current, w)}
            style={{ width: frameWidth, height: ACTION_CARD_HEIGHT }}
            contentContainerStyle={styles.scrollContent}
          >
            {slides}
          </ScrollView>
          <View style={styles.arrowOverlayLeft} pointerEvents="box-none">
            <CarouselScrollArrow direction="left" onPress={scrollPrev} visible={showLeftArrow} />
          </View>
          <View style={styles.arrowOverlayRight} pointerEvents="box-none">
            <CarouselScrollArrow direction="right" onPress={scrollNext} visible={showRightArrow} />
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <View style={[styles.row, { width: frameWidth, height: ACTION_CARD_HEIGHT }]}>{slides}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 8,
    marginHorizontal: H_PAD,
  },
  carouselFrame: {
    position: 'relative',
  },
  scrollContent: {
    flexDirection: 'row',
    gap: GAP,
    alignItems: 'center',
    paddingRight: GAP,
  },
  row: {
    flexDirection: 'row',
    gap: GAP,
    alignItems: 'center',
  },
  arrowOverlayLeft: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: ARROW_GUTTER,
    justifyContent: 'center',
    alignItems: 'flex-start',
    zIndex: 2,
  },
  arrowOverlayRight: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: ARROW_GUTTER,
    justifyContent: 'center',
    alignItems: 'flex-end',
    zIndex: 2,
  },
  arrowHit: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrowHitLeft: {
    marginLeft: -ARROW_SIZE / 2 + 1,
  },
  arrowHitRight: {
    marginRight: -ARROW_SIZE / 2 + 1,
  },
  arrowHitPressed: {
    opacity: 0.72,
  },
  arrowCircle: {
    width: ARROW_SIZE,
    height: ARROW_SIZE,
    borderRadius: ARROW_SIZE / 2,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#2E7D32',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(129, 199, 132, 0.35)',
  },
  actionSurface: {
    borderRadius: 16,
    paddingVertical: 8,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.88)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.95)',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
    overflow: 'hidden',
  },
  actionIconWrap: {
    marginBottom: 2,
  },
  actionLabel: {
    fontWeight: '600',
    fontSize: 10,
    lineHeight: 13,
    color: '#1A1A1A',
    textAlign: 'center',
  },
});
