import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { Platform, StyleSheet, View, ScrollView } from 'react-native';
import {
  Button,
  Dialog,
  Portal,
  Text,
  TextInput,
  ActivityIndicator,
  Chip,
  Checkbox,
  Divider,
  Surface,
} from 'react-native-paper';
import { useShareIntent } from 'expo-share-intent';
import * as api from '../services/api';
import { WhatsAppParsedAction } from '../types';
import {
  clampWhatsAppMessageText,
  formatConfidence,
  logImportError,
  toUserFacingMessage,
} from '../utils/whatsappAction';

type WhatsAppShareContextValue = {
  openWithText: (text: string) => void;
};

const WhatsAppShareContext = createContext<WhatsAppShareContextValue | null>(null);

export function useWhatsAppShare() {
  const ctx = useContext(WhatsAppShareContext);
  if (!ctx) {
    throw new Error('useWhatsAppShare must be used within WhatsAppShareProvider');
  }
  return ctx;
}

const INTENT_LABELS: Record<string, string> = {
  add_to_shopping_list: 'Add to shopping list',
  mark_out_of_stock: 'Mark out of stock',
  add_inventory: 'Add to inventory',
  note_dislike: 'Save food preference',
  report_cooked_dish: 'Log dish cooked',
  unknown: 'Not understood',
};

const INTENT_COLORS: Record<string, { fg: string; bg: string }> = {
  add_to_shopping_list: { fg: '#2196F3', bg: 'rgba(33, 150, 243, 0.13)' },
  mark_out_of_stock: { fg: '#FF9800', bg: 'rgba(255, 152, 0, 0.13)' },
  add_inventory: { fg: '#4CAF50', bg: 'rgba(76, 175, 80, 0.13)' },
  note_dislike: { fg: '#9C27B0', bg: 'rgba(156, 39, 176, 0.13)' },
  report_cooked_dish: { fg: '#795548', bg: 'rgba(121, 85, 72, 0.13)' },
  unknown: { fg: '#999999', bg: 'rgba(153, 153, 153, 0.13)' },
};

function intentColors(intent: string) {
  return INTENT_COLORS[intent] ?? INTENT_COLORS.unknown;
}

function WhatsAppShareModal({
  visible,
  initialText,
  onDismiss,
}: {
  visible: boolean;
  initialText: string;
  onDismiss: () => void;
}) {
  const [text, setText] = useState(initialText);
  const [parsing, setParsing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [action, setAction] = useState<WhatsAppParsedAction | null>(null);
  const [error, setError] = useState('');
  const [doneMsg, setDoneMsg] = useState('');
  const [userApproved, setUserApproved] = useState(false);

  useEffect(() => {
    if (visible) {
      setText(initialText);
      setAction(null);
      setError('');
      setDoneMsg('');
      setUserApproved(false);
    }
  }, [visible, initialText]);

  useEffect(() => {
    setUserApproved(false);
  }, [action?.intent, action?.summary, action?.entities?.item_name]);

  useEffect(() => {
    const trimmed = clampWhatsAppMessageText(initialText);
    if (!visible || !trimmed) return;
    let cancelled = false;
    (async () => {
      setParsing(true);
      setError('');
      try {
        const res = await api.parseWhatsAppMessage(trimmed);
        if (!cancelled) setAction(res.action);
      } catch (e: unknown) {
        if (!cancelled) {
          const raw = e instanceof Error ? e.message : String(e);
          logImportError('parse', { rawMessage: raw, cause: e });
          setError(toUserFacingMessage(raw));
          setAction(null);
        }
      } finally {
        if (!cancelled) setParsing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, initialText]);

  const handleReparse = async () => {
    const trimmed = clampWhatsAppMessageText(text);
    if (!trimmed) return;
    setParsing(true);
    setError('');
    setAction(null);
    try {
      const res = await api.parseWhatsAppMessage(trimmed);
      setAction(res.action);
    } catch (e: unknown) {
      const raw = e instanceof Error ? e.message : String(e);
      logImportError('parse', { rawMessage: raw, cause: e });
      setError(toUserFacingMessage(raw));
    } finally {
      setParsing(false);
    }
  };

  const handleApply = async () => {
    if (!action) return;
    setApplying(true);
    setError('');
    try {
      const res = await api.applyWhatsAppAction(action);
      setDoneMsg(res.message || 'Done');
    } catch (e: unknown) {
      const raw = e instanceof Error ? e.message : String(e);
      logImportError('apply', { rawMessage: raw, cause: e });
      setError(toUserFacingMessage(raw));
    } finally {
      setApplying(false);
    }
  };

  const canApply =
    action &&
    action.intent !== 'unknown' &&
    action.confidence >= 0.5 &&
    userApproved &&
    !doneMsg;

  const confidence = action?.confidence ?? 0;
  const entities = action?.entities;
  const lowConfidence = action && confidence > 0 && confidence < 0.75;

  return (
    <Portal>
      <Dialog visible={visible} onDismiss={onDismiss} style={styles.dialog}>
        <Dialog.Icon icon="shield-check-outline" color="#2E7D32" />
        <Dialog.Title style={styles.dialogTitle}>Review suggestion</Dialog.Title>
        <Dialog.Content style={styles.dialogContent}>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
          <Surface style={styles.disclaimer} elevation={0}>
            <Text variant="labelMedium" style={styles.disclaimerTitle}>
              Nothing changes until you confirm
            </Text>
            <Text variant="bodySmall" style={styles.disclaimerBody}>
              AI reads your note and proposes an action. Check both boxes below match what you meant, then apply.
            </Text>
          </Surface>

          <Text variant="labelMedium" style={styles.sectionLabel}>Your message</Text>
          <View style={styles.originalBox}>
            <Text variant="bodyMedium" style={styles.originalText}>
              {text.trim() || '—'}
            </Text>
          </View>

          {!doneMsg && (
            <>
              <TextInput
                label="Edit message (optional)"
                value={text}
                onChangeText={(v) => {
                  setText(v);
                  setUserApproved(false);
                }}
                mode="outlined"
                multiline
                numberOfLines={2}
                style={styles.input}
                editable={!parsing && !applying}
              />
              <Button mode="text" compact onPress={handleReparse} disabled={parsing || !text.trim()}>
                Re-analyze after edit
              </Button>
            </>
          )}

          {parsing && (
            <View style={styles.center}>
              <ActivityIndicator />
              <Text variant="bodySmall" style={styles.muted}>Understanding message…</Text>
            </View>
          )}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          {doneMsg ? (
            <Text style={styles.success}>{doneMsg}</Text>
          ) : null}

          {action && !parsing && !doneMsg && (
            <>
              <Divider style={styles.divider} />
              <Text variant="labelMedium" style={styles.sectionLabel}>Proposed action</Text>
              {lowConfidence && (
                <Surface style={styles.warnBox} elevation={0}>
                  <Text variant="bodySmall" style={styles.warnText}>
                    Low confidence ({formatConfidence(confidence)}%) — please verify this matches what was said.
                  </Text>
                </Surface>
              )}
              <View style={styles.preview}>
                <Chip
                  style={{ backgroundColor: intentColors(action.intent).bg }}
                  textStyle={{ color: intentColors(action.intent).fg, fontWeight: '700' }}
                >
                  {INTENT_LABELS[action.intent] || action.intent}
                </Chip>
                <Text variant="bodyMedium" style={styles.summary}>
                  {action.summary || '—'}
                </Text>
                {entities?.item_name ? (
                  <Text variant="bodySmall" style={styles.muted}>
                    Item: {entities.item_name}
                    {entities.qty ? ` · ${entities.qty} ${entities.unit || 'pcs'}` : ''}
                  </Text>
                ) : null}
              </View>

              {action.intent === 'unknown' || action.confidence < 0.5 ? (
                <Text variant="bodySmall" style={styles.error}>
                  We could not understand this message well enough to act. Edit the text and re-analyze, or cancel.
                </Text>
              ) : (
                <PressableRow
                  checked={userApproved}
                  onPress={() => setUserApproved(!userApproved)}
                  label="This looks correct — I'm ready to apply"
                />
              )}
            </>
          )}
          </ScrollView>
        </Dialog.Content>
        <Dialog.Actions style={styles.dialogActions}>
          <Button onPress={onDismiss} textColor="#666">{doneMsg ? 'Done' : 'Cancel'}</Button>
          {!doneMsg && (
            <Button
              mode="contained"
              onPress={handleApply}
              loading={applying}
              disabled={!canApply || applying || parsing}
              buttonColor="#2E7D32"
              icon="check"
            >
              Apply changes
            </Button>
          )}
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}

function PressableRow({
  checked,
  onPress,
  label,
}: {
  checked: boolean;
  onPress: () => void;
  label: string;
}) {
  return (
    <View style={styles.approveRow}>
      <Checkbox status={checked ? 'checked' : 'unchecked'} onPress={onPress} />
      <Text variant="bodySmall" style={styles.approveLabel} onPress={onPress}>
        {label}
      </Text>
    </View>
  );
}

export function WhatsAppShareProvider({ children }: { children: React.ReactNode }) {
  const [modal, setModal] = useState<{ visible: boolean; text: string }>({
    visible: false,
    text: '',
  });

  const shareDisabled = Platform.OS === 'web';
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent({
    disabled: shareDisabled,
  });

  useEffect(() => {
    if (shareDisabled || !hasShareIntent) return;
    try {
      const raw =
        (typeof shareIntent?.text === 'string' ? shareIntent.text : '') ||
        (typeof shareIntent?.webUrl === 'string' ? shareIntent.webUrl : '');
      const shared = clampWhatsAppMessageText(raw);
      if (!shared) return;
      setModal({ visible: true, text: shared });
      resetShareIntent();
    } catch (e) {
      console.warn('share intent handling failed:', e);
      resetShareIntent();
    }
  }, [hasShareIntent, shareIntent, resetShareIntent, shareDisabled]);

  const openWithText = useCallback((text: string) => {
    setModal({ visible: true, text: clampWhatsAppMessageText(text) });
  }, []);

  const value = useMemo(() => ({ openWithText }), [openWithText]);

  return (
    <WhatsAppShareContext.Provider value={value}>
      {children}
      <WhatsAppShareModal
        visible={modal.visible}
        initialText={modal.text}
        onDismiss={() => setModal({ visible: false, text: '' })}
      />
    </WhatsAppShareContext.Provider>
  );
}

const styles = StyleSheet.create({
  dialog: {
    borderRadius: 20,
    maxWidth: 480,
    alignSelf: 'center',
    backgroundColor: '#fff',
  },
  dialogTitle: {
    textAlign: 'center',
    fontWeight: '800',
    color: '#1B5E20',
  },
  dialogContent: {
    paddingHorizontal: 0,
    maxHeight: 440,
  },
  scroll: {
    maxHeight: 400,
  },
  scrollContent: {
    paddingBottom: 8,
  },
  dialogActions: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  disclaimer: {
    backgroundColor: '#E8F5E9',
    borderRadius: 10,
    padding: 12,
    marginBottom: 14,
    borderLeftWidth: 4,
    borderLeftColor: '#2E7D32',
  },
  disclaimerTitle: {
    color: '#1B5E20',
    fontWeight: '700',
    marginBottom: 4,
  },
  disclaimerBody: {
    color: '#33691E',
    lineHeight: 18,
  },
  sectionLabel: {
    color: '#555',
    fontWeight: '600',
    marginBottom: 6,
    marginTop: 4,
  },
  originalBox: {
    backgroundColor: '#F5F5F5',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  originalText: {
    color: '#333',
    lineHeight: 22,
  },
  input: {
    marginBottom: 4,
    maxHeight: 80,
  },
  divider: {
    marginVertical: 12,
  },
  warnBox: {
    backgroundColor: '#FFF3E0',
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
  },
  warnText: {
    color: '#E65100',
    lineHeight: 18,
  },
  approveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    paddingRight: 8,
  },
  approveLabel: {
    flex: 1,
    color: '#333',
    lineHeight: 20,
  },
  center: {
    alignItems: 'center',
    paddingVertical: 16,
    gap: 8,
  },
  muted: {
    color: '#888',
  },
  error: {
    color: '#C62828',
    marginTop: 8,
  },
  success: {
    color: '#2E7D32',
    marginTop: 12,
    fontWeight: '600',
  },
  preview: {
    marginTop: 12,
    gap: 8,
    padding: 12,
    backgroundColor: '#F5F5F5',
    borderRadius: 12,
  },
  summary: {
    fontWeight: '600',
    color: '#333',
  },
  confidence: {
    color: '#999',
  },
});
