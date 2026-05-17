import React, { useState } from 'react';
import { StyleSheet, View, Pressable, ActivityIndicator } from 'react-native';
import { TextInput, Icon } from 'react-native-paper';

const SEND_SIZE = 44;

type MessageComposerProps = {
  value: string;
  onChangeText: (text: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  disabled?: boolean;
  loading?: boolean;
  accentColor?: string;
  borderColor?: string;
  submitIcon?: string;
  accessibilityLabel?: string;
};

export function MessageComposer({
  value,
  onChangeText,
  onSubmit,
  placeholder = 'Type your message…',
  disabled = false,
  loading = false,
  accentColor = '#2E7D32',
  borderColor = '#C8E6C9',
  submitIcon = 'arrow-right',
  accessibilityLabel = 'Send',
}: MessageComposerProps) {
  const [focused, setFocused] = useState(false);
  const canSubmit = value.trim().length > 0 && !disabled && !loading;

  return (
    <View
      style={[
        styles.composer,
        { borderColor: focused ? accentColor : borderColor },
        focused && styles.composerFocused,
      ]}
    >
      <TextInput
        value={value}
        onChangeText={onChangeText}
        mode="flat"
        dense
        placeholder={placeholder}
        placeholderTextColor="#9E9E9E"
        style={styles.input}
        underlineColor="transparent"
        activeUnderlineColor="transparent"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onSubmitEditing={canSubmit ? onSubmit : undefined}
        returnKeyType="send"
        blurOnSubmit
        editable={!loading}
        multiline
      />
      <Pressable
        onPress={onSubmit}
        disabled={!canSubmit}
        style={({ pressed }) => [
          styles.sendBtn,
          { backgroundColor: canSubmit ? accentColor : '#BDBDBD' },
          pressed && canSubmit && styles.sendBtnPressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
      >
        {loading ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Icon source={submitIcon} size={22} color="#fff" />
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: SEND_SIZE + 4,
    borderRadius: 14,
    borderWidth: 1.5,
    backgroundColor: '#FAFAFA',
    paddingLeft: 4,
    paddingRight: 4,
  },
  composerFocused: {
    backgroundColor: '#fff',
  },
  input: {
    flex: 1,
    fontSize: 15,
    marginTop: 0,
    paddingHorizontal: 8,
    backgroundColor: 'transparent',
    maxHeight: 88,
  },
  sendBtn: {
    width: SEND_SIZE,
    height: SEND_SIZE,
    borderRadius: SEND_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnPressed: {
    opacity: 0.9,
  },
});
