import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Icon, IconButton, Text } from 'react-native-paper';
import { palette } from '../../theme';

type AdminFeedbackBannerProps = {
  message: string;
  tone: 'success' | 'error';
  onDismiss?: () => void;
};

export function AdminFeedbackBanner({ message, tone, onDismiss }: AdminFeedbackBannerProps) {
  const isError = tone === 'error';
  return (
    <View
      style={[
        styles.banner,
        isError ? styles.error : styles.success,
      ]}
    >
      <Icon
        source={isError ? 'alert-circle-outline' : 'check-circle-outline'}
        size={18}
        color={isError ? palette.error : palette.primary}
      />
      <Text style={[styles.text, isError ? styles.errorText : styles.successText]}>{message}</Text>
      {onDismiss ? (
        <IconButton icon="close" size={16} onPress={onDismiss} style={styles.dismiss} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  success: {
    backgroundColor: palette.primaryContainer,
    borderColor: palette.primarySoft,
  },
  error: {
    backgroundColor: palette.errorBg,
    borderColor: '#FFCDD2',
  },
  text: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  successText: {
    color: palette.primaryDark,
  },
  errorText: {
    color: palette.error,
  },
  dismiss: {
    margin: 0,
    width: 28,
    height: 28,
  },
});
