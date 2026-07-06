import React from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ProfileHeaderButton } from './ProfileHeaderButton';

/** Shared green tab header — keep padding/radius in sync across main tabs. */
export const TAB_HEADER = {
  paddingHorizontal: 20,
  /** Home hero (greeting + name). */
  paddingBottom: 22,
  /** Single-line tab titles (no subtitle). */
  paddingBottomTitleOnly: 18,
  borderRadius: 28,
  backgroundColor: '#2E7D32',
} as const;

export const TAB_TOOLBAR = {
  marginHorizontal: 16,
  marginTop: 12,
  marginBottom: 10,
  gap: 10,
} as const;

type TabScreenHeaderProps = {
  title: string;
  subtitle?: string;
  style?: ViewStyle;
  decoration?: React.ReactNode;
  /** e.g. back row above the title (Meals category drill-in). */
  leading?: React.ReactNode;
  /** Extra control in the top-right (above profile avatar). */
  trailing?: React.ReactNode;
};

export function TabScreenHeader({
  title,
  subtitle,
  style,
  decoration,
  leading,
  trailing,
}: TabScreenHeaderProps) {
  const insets = useSafeAreaInsets();
  const titleOnly = !subtitle;
  return (
    <View
      style={[
        styles.header,
        { paddingTop: insets.top + 14 },
        titleOnly && styles.headerTitleOnly,
        style,
      ]}
    >
      {decoration}
      <View style={[styles.headerTopRow, titleOnly && styles.headerTopRowTitleOnly]}>
        <View style={styles.headerTextBlock}>
          {leading}
          <Text variant="headlineSmall" style={styles.headerTitle}>
            {title}
          </Text>
          {subtitle ? (
            <Text variant="bodyMedium" style={styles.headerSub}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        <View style={styles.headerTrailing}>
          {trailing}
          <View style={styles.profileAlign}>
            <ProfileHeaderButton />
          </View>
        </View>
      </View>
    </View>
  );
}

type TabScreenToolbarRowProps = {
  children: React.ReactNode;
  style?: ViewStyle;
  /** Full-width stack (e.g. Cook message composer). Default: horizontal row (search + button). */
  block?: boolean;
};

/** Row directly under the green header (search, compose, etc.). */
export function TabScreenToolbarRow({ children, style, block }: TabScreenToolbarRowProps) {
  return <View style={[styles.toolbarRow, block && styles.toolbarRowBlock, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  header: {
    backgroundColor: TAB_HEADER.backgroundColor,
    paddingHorizontal: TAB_HEADER.paddingHorizontal,
    paddingBottom: TAB_HEADER.paddingBottom,
    borderBottomLeftRadius: TAB_HEADER.borderRadius,
    borderBottomRightRadius: TAB_HEADER.borderRadius,
    overflow: 'hidden',
  },
  headerTitleOnly: {
    paddingBottom: TAB_HEADER.paddingBottomTitleOnly,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  headerTopRowTitleOnly: {
    alignItems: 'center',
    minHeight: 44,
  },
  headerTextBlock: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  headerTrailing: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 8,
    flexShrink: 0,
  },
  profileAlign: {
    alignSelf: 'center',
  },
  headerTitle: {
    color: '#fff',
    fontWeight: '800',
    letterSpacing: 0.3,
    lineHeight: 32,
  },
  headerSub: {
    color: 'rgba(255,255,255,0.92)',
    marginTop: 6,
    lineHeight: 22,
  },
  toolbarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: TAB_TOOLBAR.marginHorizontal,
    marginTop: TAB_TOOLBAR.marginTop,
    marginBottom: TAB_TOOLBAR.marginBottom,
    gap: TAB_TOOLBAR.gap,
  },
  toolbarRowBlock: {
    flexDirection: 'column',
    alignItems: 'stretch',
  },
});
