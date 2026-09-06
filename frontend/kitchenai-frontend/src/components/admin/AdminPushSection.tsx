import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Text, TextInput } from 'react-native-paper';
import { FilterPill, FilterPillRow } from '../FilterPill';
import { AppConfirmDialog } from '../AppConfirmDialog';
import { AdminFeedbackBanner } from './AdminFeedbackBanner';
import { panelSendPush } from '../../services/api';
import { palette } from '../../theme';
import { userFacingError } from '../../utils/userFacingError';

const SCREEN_OPTIONS = ['Home', 'Meals', 'Cook', 'Inventory', 'Shopping', 'Profile'] as const;

export function AdminPushSection() {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [screen, setScreen] = useState('');
  const [campaign, setCampaign] = useState('');
  const [email, setEmail] = useState('');
  const [broadcast, setBroadcast] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);

  const canSend = title.trim().length > 0 && body.trim().length > 0 && (broadcast || email.trim().length > 0);

  const previewSubtitle = useMemo(() => {
    if (screen) return `Opens ${screen} when tapped`;
    return 'No deep link — opens the app home';
  }, [screen]);

  const handleSend = async () => {
    setSending(true);
    setError('');
    setSuccess('');
    try {
      const result = await panelSendPush({
        title: title.trim(),
        body: body.trim(),
        screen: screen.trim() || undefined,
        campaign_key: campaign.trim() || undefined,
        broadcast,
        user_email: broadcast ? undefined : email.trim(),
      });
      setSuccess(
        `Delivered to ${result.tokens_targeted} device(s) — ${result.tickets_ok} ok, ${result.tickets_error} failed`,
      );
      setConfirmOpen(false);
    } catch (e) {
      setError(userFacingError(e, 'Failed to send push notification.'));
      setConfirmOpen(false);
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.lead}>
        Send a marketing or feature announcement to users who opted in on iOS and Android.
      </Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Compose</Text>

        <TextInput
          label="Notification title"
          value={title}
          onChangeText={setTitle}
          mode="outlined"
          style={styles.input}
          maxLength={80}
          right={<TextInput.Affix text={`${title.length}/80`} />}
        />
        <TextInput
          label="Message body"
          value={body}
          onChangeText={setBody}
          mode="outlined"
          multiline
          numberOfLines={3}
          style={styles.input}
          maxLength={240}
        />
        <Text style={styles.charCount}>{body.length}/240 characters</Text>

        <Text style={styles.fieldLabel}>Open screen (optional)</Text>
        <FilterPillRow style={styles.pillRow}>
          <FilterPill label="None" selected={!screen} onPress={() => setScreen('')} />
          {SCREEN_OPTIONS.map((opt) => (
            <FilterPill
              key={opt}
              label={opt}
              selected={screen === opt}
              onPress={() => setScreen(opt)}
            />
          ))}
        </FilterPillRow>

        <TextInput
          label="Campaign key (optional)"
          value={campaign}
          onChangeText={setCampaign}
          mode="outlined"
          placeholder="e.g. holi-2026"
          style={styles.input}
        />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Audience</Text>
        <View style={styles.modeRow}>
          <FilterPill
            label="All opted-in users"
            icon="account-group-outline"
            selected={broadcast}
            onPress={() => setBroadcast(true)}
            style={styles.modePill}
          />
          <FilterPill
            label="Single user"
            icon="account-outline"
            selected={!broadcast}
            onPress={() => setBroadcast(false)}
            style={styles.modePill}
          />
        </View>
        {!broadcast ? (
          <TextInput
            label="User email"
            value={email}
            onChangeText={setEmail}
            mode="outlined"
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="user@example.com"
            style={styles.input}
          />
        ) : (
          <Text style={styles.hint}>
            Broadcast sends to every device with marketing push enabled.
          </Text>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Preview</Text>
        <View style={styles.preview}>
          <View style={styles.previewIcon}>
            <Text style={styles.previewIconText}>RB</Text>
          </View>
          <View style={styles.previewBody}>
            <Text style={styles.previewTitle} numberOfLines={1}>
              {title.trim() || 'Notification title'}
            </Text>
            <Text style={styles.previewMessage} numberOfLines={2}>
              {body.trim() || 'Your message will appear here.'}
            </Text>
            <Text style={styles.previewMeta}>{previewSubtitle}</Text>
          </View>
        </View>
      </View>

      <Button
        mode="contained"
        icon="send"
        onPress={() => setConfirmOpen(true)}
        loading={sending}
        disabled={!canSend || sending}
        style={styles.sendBtn}
        contentStyle={styles.sendBtnContent}
      >
        {broadcast ? 'Send to all users' : 'Send to user'}
      </Button>

      {error ? <AdminFeedbackBanner message={error} tone="error" onDismiss={() => setError('')} /> : null}
      {success ? (
        <AdminFeedbackBanner message={success} tone="success" onDismiss={() => setSuccess('')} />
      ) : null}

      <AppConfirmDialog
        visible={confirmOpen}
        title={broadcast ? 'Send broadcast push?' : 'Send test push?'}
        message={
          broadcast
            ? `This will notify all opted-in users:\n\n"${title.trim()}"`
            : `Send to ${email.trim()}:\n\n"${title.trim()}"`
        }
        confirmLabel="Send now"
        icon="bell-ring-outline"
        loading={sending}
        warning={broadcast}
        onDismiss={() => setConfirmOpen(false)}
        onConfirm={() => void handleSend()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 16,
  },
  lead: {
    color: palette.textSecondary,
    lineHeight: 22,
    fontSize: 15,
  },
  card: {
    backgroundColor: palette.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: palette.borderLight,
    padding: 16,
    gap: 12,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: palette.text,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: palette.textSecondary,
    marginTop: 4,
  },
  input: {
    backgroundColor: palette.surface,
  },
  charCount: {
    fontSize: 12,
    color: palette.textMuted,
    textAlign: 'right',
    marginTop: -6,
  },
  modeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  modePill: {
    flexGrow: 1,
  },
  hint: {
    color: palette.textMuted,
    fontSize: 13,
    lineHeight: 19,
  },
  preview: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: palette.background,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: palette.borderLight,
  },
  previewIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: palette.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewIconText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 14,
  },
  previewBody: {
    flex: 1,
    gap: 2,
  },
  previewTitle: {
    fontWeight: '700',
    color: palette.text,
    fontSize: 15,
  },
  previewMessage: {
    color: palette.textSecondary,
    fontSize: 14,
    lineHeight: 19,
  },
  previewMeta: {
    color: palette.textMuted,
    fontSize: 12,
    marginTop: 4,
  },
  sendBtn: {
    borderRadius: 12,
  },
  sendBtnContent: {
    paddingVertical: 6,
  },
  pillRow: {
    marginHorizontal: 0,
    marginBottom: 0,
  },
});
