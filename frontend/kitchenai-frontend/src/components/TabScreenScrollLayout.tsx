import React from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  type RefreshControlProps,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { keyboardAwareScrollViewProps } from '../utils/keyboardAvoidance';

type TabScreenScrollLayoutProps = {
  scrollRef?: React.RefObject<ScrollView | null>;
  header: React.ReactNode;
  /** Stays fixed under the header (e.g. tab switcher). */
  sticky?: React.ReactNode;
  children: React.ReactNode;
  refreshControl?: React.ReactElement<RefreshControlProps>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
  scrollStyle?: StyleProp<ViewStyle>;
  keyboardShouldPersistTaps?: ScrollViewProps['keyboardShouldPersistTaps'];
  showsVerticalScrollIndicator?: boolean;
  onScroll?: ScrollViewProps['onScroll'];
  scrollEventThrottle?: number;
};

/** Green header stays pinned; only `children` scroll. */
export function TabScreenScrollLayout({
  scrollRef,
  header,
  sticky,
  children,
  refreshControl,
  contentContainerStyle,
  style,
  scrollStyle,
  keyboardShouldPersistTaps,
  showsVerticalScrollIndicator = false,
  onScroll,
  scrollEventThrottle,
}: TabScreenScrollLayoutProps) {
  return (
    <View style={[styles.root, style]}>
      {header}
      {sticky}
      <ScrollView
        ref={scrollRef}
        style={[styles.scroll, scrollStyle]}
        contentContainerStyle={contentContainerStyle}
        refreshControl={refreshControl}
        showsVerticalScrollIndicator={showsVerticalScrollIndicator}
        keyboardShouldPersistTaps={keyboardShouldPersistTaps ?? keyboardAwareScrollViewProps.keyboardShouldPersistTaps}
        keyboardDismissMode={keyboardAwareScrollViewProps.keyboardDismissMode}
        automaticallyAdjustKeyboardInsets={keyboardAwareScrollViewProps.automaticallyAdjustKeyboardInsets}
        onScroll={onScroll}
        scrollEventThrottle={scrollEventThrottle}
      >
        {children}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#FAFAFA',
  },
  scroll: {
    flex: 1,
  },
});
