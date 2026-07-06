import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import { IconButton, Portal, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useWebScrollViewGuard } from '../hooks/useWebScrollViewGuard';
import { palette } from '../theme';

const SCREEN_HEIGHT = Dimensions.get('window').height;
const DISMISS_DRAG_THRESHOLD = 80;

type Props = {
  visible: boolean;
  onDismiss: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  dismissDisabled?: boolean;
  maxHeightRatio?: number;
  sheetStyle?: ViewStyle;
  scrollable?: boolean;
  footerStyle?: ViewStyle;
};

export function BottomSheet({
  visible,
  onDismiss,
  title,
  subtitle,
  children,
  footer,
  dismissDisabled = false,
  maxHeightRatio = 0.88,
  sheetStyle,
  scrollable = true,
  footerStyle,
}: Props) {
  const insets = useSafeAreaInsets();
  const slideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const dragAnim = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(visible);
  const dismissDisabledRef = useRef(dismissDisabled);
  const onDismissRef = useRef(onDismiss);
  const scrollRef = useRef<ScrollView>(null);
  const { handleScroll, handleContentSizeChange } = useWebScrollViewGuard(
    scrollRef,
    visible && scrollable,
  );

  dismissDisabledRef.current = dismissDisabled;
  onDismissRef.current = onDismiss;

  const runCloseAnimation = () => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: SCREEN_HEIGHT,
        duration: 220,
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (!finished) return;
      dragAnim.setValue(0);
      setMounted(false);
    });
  };

  const requestDismiss = () => {
    if (dismissDisabledRef.current) return;
    onDismissRef.current();
  };

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) =>
        !dismissDisabledRef.current && g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_, g) => {
        if (g.dy > 0) dragAnim.setValue(g.dy);
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy > DISMISS_DRAG_THRESHOLD || g.vy > 0.75) {
          requestDismiss();
          return;
        }
        Animated.spring(dragAnim, {
          toValue: 0,
          damping: 24,
          stiffness: 320,
          useNativeDriver: true,
        }).start();
      },
      onPanResponderTerminate: () => {
        Animated.spring(dragAnim, {
          toValue: 0,
          damping: 24,
          stiffness: 320,
          useNativeDriver: true,
        }).start();
      },
    }),
  ).current;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      slideAnim.setValue(SCREEN_HEIGHT);
      dragAnim.setValue(0);
      fadeAnim.setValue(0);
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 220,
          useNativeDriver: true,
        }),
        Animated.spring(slideAnim, {
          toValue: 0,
          damping: 28,
          stiffness: 320,
          useNativeDriver: true,
        }),
      ]).start();
      return;
    }

    if (mounted) {
      runCloseAnimation();
    }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!mounted) return null;

  const sheetTranslateY = Animated.add(slideAnim, dragAnim);

  const bodyContent = scrollable ? (
    <ScrollView
      ref={scrollRef}
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      bounces={false}
      nestedScrollEnabled
      onScroll={handleScroll}
      onContentSizeChange={handleContentSizeChange}
      scrollEventThrottle={16}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={styles.staticBody}>{children}</View>
  );

  return (
    <Modal
      transparent
      visible={mounted}
      animationType="none"
      onRequestClose={requestDismiss}
    >
      <Portal.Host>
        <View style={styles.root}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={requestDismiss}
            disabled={dismissDisabled}
            accessibilityLabel="Close sheet"
          >
            <Animated.View style={[styles.backdrop, { opacity: fadeAnim }]} />
          </Pressable>

          <Animated.View
            style={[
              styles.sheet,
              {
                maxHeight: SCREEN_HEIGHT * maxHeightRatio,
                paddingBottom: Math.max(insets.bottom, 12),
                transform: [{ translateY: sheetTranslateY }],
              },
              sheetStyle,
            ]}
          >
            <View {...panResponder.panHandlers} style={styles.dragZone}>
              <View style={styles.handle} />
            </View>

            <View style={styles.header}>
              <View style={styles.headerText}>
                <Text variant="titleLarge" style={styles.title}>{title}</Text>
                {subtitle ? (
                  <Text variant="bodySmall" style={styles.subtitle}>{subtitle}</Text>
                ) : null}
              </View>
              <IconButton
                icon="close"
                size={22}
                iconColor={palette.textSecondary}
                onPress={requestDismiss}
                disabled={dismissDisabled}
                style={styles.closeBtn}
              />
            </View>

            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
              style={styles.body}
              keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
            >
              {bodyContent}
              {footer ? <View style={[styles.footer, footerStyle]}>{footer}</View> : null}
            </KeyboardAvoidingView>
          </Animated.View>
        </View>
      </Portal.Host>
    </Modal>
  );
}

export const bottomSheetPrimaryBtn = {
  button: {
    borderRadius: 12,
    width: '100%' as const,
  },
  content: {
    height: 52,
  },
  label: {
    fontSize: 16,
    fontWeight: '700' as const,
  },
};

export const bottomSheetInput = {
  marginBottom: 12,
  backgroundColor: '#fff',
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 4,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -4 },
    elevation: 24,
    ...Platform.select({
      web: { overflow: 'visible' as const },
      default: {},
    }),
  },
  dragZone: {
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 4,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: palette.border,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 16,
    gap: 8,
  },
  headerText: {
    flex: 1,
    paddingTop: 2,
  },
  title: {
    fontWeight: '800',
    color: palette.text,
    fontSize: 20,
  },
  subtitle: {
    color: palette.textSecondary,
    marginTop: 4,
    lineHeight: 18,
  },
  closeBtn: {
    margin: 0,
    marginTop: -4,
  },
  body: {
    flexGrow: 0,
    flexShrink: 1,
    ...Platform.select({
      web: { overflow: 'visible' as const },
      default: {},
    }),
  },
  scroll: {
    flexGrow: 0,
  },
  scrollContent: {
    paddingBottom: 8,
  },
  staticBody: {
    paddingBottom: 4,
    ...Platform.select({
      web: { overflow: 'visible' as const },
      default: {},
    }),
  },
  footer: {
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: palette.borderLight,
    backgroundColor: '#fff',
    zIndex: 1,
    elevation: 1,
  },
});
