import React, { useState } from 'react';
import { StyleSheet, View, Platform, Keyboard } from 'react-native';
import { Surface, Text, Icon } from 'react-native-paper';
import { useWhatsAppShare } from './WhatsAppShareHandler';
import { clampWhatsAppMessageText } from '../utils/whatsappAction';
import { MessageComposer } from './MessageComposer';

const isWeb = Platform.OS === 'web';

export function MessageImportCard() {
  const { openWithText } = useWhatsAppShare();
  const [draft, setDraft] = useState('');

  const handleSubmit = () => {
    const text = clampWhatsAppMessageText(draft);
    if (!text) return;
    Keyboard.dismiss();
    openWithText(text);
    setDraft('');
  };

  return (
    <Surface style={styles.card} elevation={1}>
      <View style={styles.titleRow}>
        <View style={styles.titleIcon}>
          <Icon source="message-text-outline" size={18} color="#2E7D32" />
        </View>
        <View style={styles.titleText}>
          <Text variant="titleSmall" style={styles.title}>
            Quick import
          </Text>
          <Text variant="bodySmall" style={styles.subtitle} numberOfLines={2}>
            Paste a note — you approve before anything changes.
          </Text>
        </View>
      </View>

      <MessageComposer
        value={draft}
        onChangeText={setDraft}
        onSubmit={handleSubmit}
        placeholder='e.g. "milk khatam ho gaya"'
        accessibilityLabel="Review suggestion"
      />

      {!isWeb && (
        <Text variant="labelSmall" style={styles.footerHint}>
          Or Share → KITCHMATE from any app
        </Text>
      )}
    </Surface>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 16,
    backgroundColor: '#fff',
    padding: 14,
    borderWidth: 1,
    borderColor: '#E8F5E9',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  titleIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#E8F5E9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleText: {
    flex: 1,
  },
  title: {
    fontWeight: '700',
    color: '#1B5E20',
  },
  subtitle: {
    color: '#666',
    marginTop: 2,
    lineHeight: 17,
    fontSize: 12,
  },
  footerHint: {
    color: '#9E9E9E',
    marginTop: 8,
    fontSize: 11,
    textAlign: 'center',
  },
});
