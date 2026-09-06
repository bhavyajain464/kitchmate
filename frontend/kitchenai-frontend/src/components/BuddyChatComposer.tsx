import React, { useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { ActivityIndicator, Icon } from 'react-native-paper';
import { palette } from '../theme';

const BAR_COUNT = 24;
const ACTION_SIZE = 40;

type BuddyChatComposerProps = {
  value: string;
  onChangeText: (text: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  disabled?: boolean;
  loading?: boolean;
  voiceSupported: boolean;
  isRecording: boolean;
  listening: boolean;
  paused: boolean;
  durationLabel: string;
  voiceTranscript?: string;
  onStartRecording: () => void;
  onPauseRecording: () => void;
  onResumeRecording: () => void;
  onCancelRecording: () => void;
  onSubmitRecording: () => void;
};

function VoiceWaveform({ active }: { active: boolean }) {
  const anims = useRef(Array.from({ length: BAR_COUNT }, () => new Animated.Value(0.25))).current;

  useEffect(() => {
    if (!active) {
      anims.forEach((anim) => anim.setValue(0.25));
      return;
    }

    const loops = anims.map((anim, index) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(anim, {
            toValue: 0.35 + ((index * 17) % 60) / 100,
            duration: 220 + (index % 5) * 40,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(anim, {
            toValue: 0.15 + ((index * 11) % 30) / 100,
            duration: 220 + (index % 4) * 35,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
      ),
    );

    loops.forEach((loop) => loop.start());
    return () => loops.forEach((loop) => loop.stop());
  }, [active, anims]);

  return (
    <View style={styles.waveformRow}>
      {anims.map((anim, index) => (
        <Animated.View
          key={index}
          style={[
            styles.waveBar,
            {
              transform: [
                {
                  scaleY: anim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.35, 1],
                  }),
                },
              ],
            },
          ]}
        />
      ))}
    </View>
  );
}

function CircleAction({
  icon,
  onPress,
  disabled,
  backgroundColor,
  iconColor = '#fff',
  accessibilityLabel,
}: {
  icon: string;
  onPress: () => void;
  disabled?: boolean;
  backgroundColor: string;
  iconColor?: string;
  accessibilityLabel: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.circleBtn,
        { backgroundColor: disabled ? '#BDBDBD' : backgroundColor },
        pressed && !disabled && styles.circleBtnPressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <Icon source={icon} size={20} color={iconColor} />
    </Pressable>
  );
}

export function BuddyChatComposer({
  value,
  onChangeText,
  onSubmit,
  placeholder = 'Message your kitchen buddy…',
  disabled = false,
  loading = false,
  voiceSupported,
  isRecording,
  listening,
  paused,
  durationLabel,
  voiceTranscript = '',
  onStartRecording,
  onPauseRecording,
  onResumeRecording,
  onCancelRecording,
  onSubmitRecording,
}: BuddyChatComposerProps) {
  const hasText = value.trim().length > 0;
  const canSubmitText = hasText && !disabled && !loading;

  const recordingLabel = useMemo(() => {
    if (listening) return 'Recording voice message';
    if (paused) return 'Voice recording paused';
    return 'Voice message';
  }, [listening, paused]);

  if (isRecording) {
    return (
      <View style={styles.recordingBar} accessibilityLabel={recordingLabel}>
        <Pressable
          onPress={onCancelRecording}
          disabled={disabled}
          style={({ pressed }) => [styles.iconAction, pressed && styles.iconActionPressed]}
          accessibilityRole="button"
          accessibilityLabel="Delete recording"
        >
          <Icon source="delete-outline" size={24} color={palette.error} />
        </Pressable>

        <View style={styles.recordingCenter}>
          {listening ? <View style={styles.recordingDot} /> : null}
          <Text style={styles.durationText}>{durationLabel}</Text>
          {voiceTranscript.trim() ? (
            <Text style={styles.liveTranscript} numberOfLines={2}>
              {voiceTranscript}
            </Text>
          ) : (
            <VoiceWaveform active={listening} />
          )}
        </View>

        {listening ? (
          <Pressable
            onPress={onPauseRecording}
            disabled={disabled}
            style={({ pressed }) => [styles.iconAction, pressed && styles.iconActionPressed]}
            accessibilityRole="button"
            accessibilityLabel="Pause recording"
          >
            <Icon source="pause" size={24} color={palette.textMuted} />
          </Pressable>
        ) : (
          <Pressable
            onPress={onResumeRecording}
            disabled={disabled}
            style={({ pressed }) => [styles.iconAction, pressed && styles.iconActionPressed]}
            accessibilityRole="button"
            accessibilityLabel="Resume recording"
          >
            <Icon source="microphone" size={24} color={palette.error} />
          </Pressable>
        )}

        <CircleAction
          icon="send"
          onPress={onSubmitRecording}
          disabled={disabled || loading}
          backgroundColor={palette.primary}
          accessibilityLabel="Send voice message"
        />
      </View>
    );
  }

  return (
    <View style={styles.composerBar}>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#9E9E9E"
        style={styles.input}
        multiline
        editable={!loading && !disabled}
        accessibilityLabel="Message input"
      />

      {loading ? (
        <View style={styles.trailingAction}>
          <ActivityIndicator size="small" color={palette.primary} />
        </View>
      ) : hasText ? (
        <CircleAction
          icon="send"
          onPress={onSubmit}
          disabled={!canSubmitText}
          backgroundColor={palette.primary}
          accessibilityLabel="Send message"
        />
      ) : (
        <Pressable
          onPress={onStartRecording}
          disabled={disabled}
          style={({ pressed }) => [
            styles.trailingAction,
            styles.micBtn,
            pressed && !disabled && styles.iconActionPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={voiceSupported ? 'Record voice message' : 'Voice not available'}
        >
          <Icon
            source="microphone"
            size={24}
            color={voiceSupported ? palette.textMuted : '#BDBDBD'}
          />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  composerBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    minHeight: ACTION_SIZE + 12,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: palette.borderLight,
    backgroundColor: '#fff',
    paddingLeft: 16,
    paddingRight: 6,
    paddingVertical: 6,
  },
  input: {
    flex: 1,
    fontSize: 16,
    lineHeight: 22,
    maxHeight: 120,
    paddingTop: 8,
    paddingBottom: 8,
    paddingRight: 8,
    color: palette.text,
  },
  trailingAction: {
    width: ACTION_SIZE,
    height: ACTION_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  micBtn: {
    borderRadius: ACTION_SIZE / 2,
  },
  circleBtn: {
    width: ACTION_SIZE,
    height: ACTION_SIZE,
    borderRadius: ACTION_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  circleBtnPressed: {
    opacity: 0.88,
  },
  recordingBar: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: ACTION_SIZE + 12,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: palette.borderLight,
    backgroundColor: '#fff',
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 4,
  },
  iconAction: {
    width: ACTION_SIZE,
    height: ACTION_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: ACTION_SIZE / 2,
  },
  iconActionPressed: {
    backgroundColor: '#F3F4F3',
  },
  recordingCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 4,
    minWidth: 0,
  },
  recordingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: palette.error,
  },
  durationText: {
    fontSize: 16,
    fontWeight: '600',
    color: palette.text,
    minWidth: 36,
  },
  liveTranscript: {
    flex: 1,
    fontSize: 14,
    lineHeight: 18,
    color: palette.textMuted,
    minWidth: 0,
  },
  waveformRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 2,
    minWidth: 0,
    height: 28,
  },
  waveBar: {
    flex: 1,
    maxWidth: 4,
    height: 24,
    borderRadius: 2,
    backgroundColor: palette.primary,
    opacity: 0.75,
  },
});
