import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Dimensions,
  FlatList,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import {
  Button,
  Icon,
  Text,
} from 'react-native-paper';
import * as api from '../services/api';
import { WhatsAppParsedAction } from '../types';
import {
  appliableActions,
  clampWhatsAppMessageText,
  logImportError,
  toUserFacingMessage,
} from '../utils/whatsappAction';
import {
  BUDDY_QUICK_PROMPTS,
  BUDDY_WELCOME,
  type BuddyChatTurn,
  buddyReplyForActions,
  buddySuccessReply,
  buildParseHistory,
  taskCardLabel,
  tryLocalBuddyReply,
} from '../utils/aiBuddyChat';
import { BottomSheet, bottomSheetPrimaryBtn } from './BottomSheet';
import { BuddyChatComposer } from './BuddyChatComposer';
import { useAppRefresh } from '../context/AppRefreshContext';
import { useLocale } from '../context/LocaleContext';
import { speechLocaleFromAppLang, useVoiceInput } from '../hooks/useVoiceInput';
import { palette } from '../theme';

const SCREEN_HEIGHT = Dimensions.get('window').height;

type ChatMessage =
  | { id: string; role: 'user'; text: string }
  | { id: string; role: 'buddy'; kind: 'text'; text: string }
  | {
      id: string;
      role: 'buddy';
      kind: 'proposal';
      reply: string;
      actions: WhatsAppParsedAction[];
      status: 'pending' | 'applied' | 'cancelled';
    }
  | { id: string; role: 'buddy'; kind: 'success'; text: string }
  | { id: string; role: 'buddy'; kind: 'error'; text: string }
  | { id: string; role: 'buddy'; kind: 'typing' }
  | { id: string; role: 'buddy'; kind: 'suggestions' };

let messageSeq = 0;
function nextId(prefix: string) {
  messageSeq += 1;
  return `${prefix}-${messageSeq}`;
}

function hasPendingProposal(messages: ChatMessage[]): boolean {
  return messages.some(
    (m) => m.role === 'buddy' && m.kind === 'proposal' && m.status === 'pending',
  );
}

function chatTurnsFromMessages(messages: ChatMessage[]): BuddyChatTurn[] {
  const turns: BuddyChatTurn[] = [];
  for (const m of messages) {
    if (m.role === 'user') {
      turns.push({ role: 'user', text: m.text });
    } else if (m.kind === 'text') {
      turns.push({ role: 'buddy', text: m.text });
    } else if (m.kind === 'proposal') {
      turns.push({ role: 'buddy', text: m.reply });
    } else if (m.kind === 'success') {
      turns.push({ role: 'buddy', text: m.text });
    }
  }
  return turns;
}

function BuddyAvatar() {
  return (
    <View style={styles.avatar}>
      <Icon source="robot-happy-outline" size={17} color={palette.primaryDark} />
    </View>
  );
}

function TaskChip({ action }: { action: WhatsAppParsedAction }) {
  return (
    <View style={styles.taskChip}>
      <Text variant="bodySmall" style={styles.taskChipText}>
        {taskCardLabel(action)}
      </Text>
    </View>
  );
}

function QuickPrompts({ onPick }: { onPick: (text: string) => void }) {
  return (
    <View style={styles.suggestionsWrap}>
      <Text variant="labelSmall" style={styles.suggestionsLabel}>
        Try saying
      </Text>
      <View style={styles.suggestionRow}>
        {BUDDY_QUICK_PROMPTS.map((prompt) => (
          <Pressable
            key={prompt}
            onPress={() => onPick(prompt)}
            style={({ pressed }) => [styles.suggestionChip, pressed && styles.suggestionChipPressed]}
          >
            <Text variant="labelSmall" style={styles.suggestionText} numberOfLines={2}>
              {prompt}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function ChatBubble({
  message,
  onApply,
  onPickPrompt,
}: {
  message: ChatMessage;
  onApply?: (id: string) => void;
  onPickPrompt?: (text: string) => void;
}) {
  if (message.role === 'user') {
    return (
      <View style={styles.userRow}>
        <View style={styles.userBubble}>
          <Text variant="bodyMedium" style={styles.userText}>
            {message.text}
          </Text>
        </View>
      </View>
    );
  }

  if (message.kind === 'typing') {
    return (
      <View style={styles.buddyRow}>
        <BuddyAvatar />
        <View style={[styles.buddyBubble, styles.typingBubble]}>
          <View style={styles.typingDots}>
            <View style={styles.dot} />
            <View style={[styles.dot, styles.dotMid]} />
            <View style={styles.dot} />
          </View>
        </View>
      </View>
    );
  }

  if (message.kind === 'suggestions') {
    return (
      <View style={styles.buddyRow}>
        <BuddyAvatar />
        <View style={[styles.buddyBubble, styles.suggestionsBubble]}>
          <QuickPrompts onPick={(t) => onPickPrompt?.(t)} />
        </View>
      </View>
    );
  }

  if (message.kind === 'proposal') {
    const canConfirm = message.status === 'pending';
    const isDone = message.status === 'applied';

    return (
      <View style={styles.buddyRow}>
        <BuddyAvatar />
        <View style={styles.buddyBubble}>
          <Text variant="bodyMedium" style={styles.buddyText}>
            {message.reply}
          </Text>
          <View style={styles.taskList}>
            {message.actions.map((action, index) => (
              <TaskChip key={`${action.intent}-${index}`} action={action} />
            ))}
          </View>
          {canConfirm ? (
            <View style={styles.proposalActions}>
              <Button
                mode="contained"
                onPress={() => onApply?.(message.id)}
                buttonColor={palette.primary}
                style={styles.confirmBtn}
                contentStyle={bottomSheetPrimaryBtn.content}
                labelStyle={bottomSheetPrimaryBtn.label}
              >
                {message.actions.length > 1 ? `Confirm all (${message.actions.length})` : 'Confirm'}
              </Button>
            </View>
          ) : isDone ? (
            <Text variant="labelSmall" style={styles.confirmedLabel}>
              Confirmed
            </Text>
          ) : null}
        </View>
      </View>
    );
  }

  const isError = message.kind === 'error';
  const isSuccess = message.kind === 'success';

  return (
    <View style={styles.buddyRow}>
      <BuddyAvatar />
      <View
        style={[
          styles.buddyBubble,
          isError && styles.errorBubble,
          isSuccess && styles.successBubble,
        ]}
      >
        <Text
          variant="bodyMedium"
          style={[
            styles.buddyText,
            isError && styles.errorText,
            isSuccess && styles.successText,
          ]}
        >
          {message.text}
        </Text>
      </View>
    </View>
  );
}

export function AIBuddyChatSheet({
  visible,
  initialText,
  onDismiss,
}: {
  visible: boolean;
  initialText: string;
  onDismiss: () => void;
}) {
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [parsing, setParsing] = useState(false);
  const [applying, setApplying] = useState(false);
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const messagesRef = useRef(messages);
  const initialSentRef = useRef(false);
  const { bump } = useAppRefresh();

  messagesRef.current = messages;

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({ animated: true });
    });
  }, []);

  const removeTyping = useCallback((prev: ChatMessage[]) => {
    return prev.filter((m) => !(m.role === 'buddy' && m.kind === 'typing'));
  }, []);

  const cancelPendingProposals = useCallback((prev: ChatMessage[]) => {
    return prev.map((m) =>
      m.role === 'buddy' && m.kind === 'proposal' && m.status === 'pending'
        ? { ...m, status: 'cancelled' as const }
        : m,
    );
  }, []);

  const sendUserMessage = useCallback(
    async (raw: string) => {
      const text = clampWhatsAppMessageText(raw);
      if (!text || parsing || applying) return;

      const pending = hasPendingProposal(messagesRef.current);
      const localReply = tryLocalBuddyReply(text, { hasPendingTasks: pending });

      const userMsg: ChatMessage = { id: nextId('user'), role: 'user', text };
      const typingMsg: ChatMessage = { id: nextId('typing'), role: 'buddy', kind: 'typing' };

      setMessages((prev) => {
        const base = cancelPendingProposals(prev);
        if (localReply) {
          return [
            ...base,
            userMsg,
            { id: nextId('buddy'), role: 'buddy', kind: 'text', text: localReply },
          ];
        }
        return [...base, userMsg, typingMsg];
      });
      setDraft('');
      scrollToEnd();

      if (localReply) return;

      setParsing(true);
      try {
        const history = buildParseHistory(chatTurnsFromMessages(messagesRef.current));
        const res = await api.parseWhatsAppMessage(text, history);
        const actions = res.actions ?? (res.action ? [res.action] : []);
        const { reply, appliable } = buddyReplyForActions(actions, res.reply);

        if (appliable.length === 0) {
          const buddyMsg: ChatMessage = {
            id: nextId('buddy'),
            role: 'buddy',
            kind: 'text',
            text: reply,
          };
          setMessages((prev) => [...removeTyping(prev), buddyMsg]);
        } else {
          const proposal: ChatMessage = {
            id: nextId('proposal'),
            role: 'buddy',
            kind: 'proposal',
            reply,
            actions: appliable,
            status: 'pending',
          };
          setMessages((prev) => [...removeTyping(prev), proposal]);
        }
      } catch (e: unknown) {
        const rawMsg = e instanceof Error ? e.message : String(e);
        logImportError('parse', { rawMessage: rawMsg, cause: e });
        const errMsg: ChatMessage = {
          id: nextId('error'),
          role: 'buddy',
          kind: 'error',
          text: toUserFacingMessage(rawMsg),
        };
        setMessages((prev) => [...removeTyping(prev), errMsg]);
      } finally {
        setParsing(false);
        scrollToEnd();
      }
    },
    [applying, cancelPendingProposals, parsing, removeTyping, scrollToEnd],
  );

  const handleApply = useCallback(
    async (messageId: string) => {
      const target = messagesRef.current.find(
        (m): m is Extract<ChatMessage, { kind: 'proposal' }> =>
          m.id === messageId && m.role === 'buddy' && m.kind === 'proposal',
      );
      if (!target || target.status !== 'pending') return;

      const safe = appliableActions(target.actions);
      if (safe.length === 0) return;

      setApplying(true);
      try {
        const res = await api.applyWhatsAppActions(safe);
        const successMsg: ChatMessage = {
          id: nextId('success'),
          role: 'buddy',
          kind: 'success',
          text: buddySuccessReply(res.message || '', safe.length),
        };
        setMessages((prev) =>
          prev
            .map((m) =>
              m.id === messageId && m.role === 'buddy' && m.kind === 'proposal'
                ? { ...m, status: 'applied' as const }
                : m,
            )
            .concat(successMsg),
        );
        bump('all');
      } catch (e: unknown) {
        const rawMsg = e instanceof Error ? e.message : String(e);
        logImportError('apply', { rawMessage: rawMsg, cause: e });
        const errMsg: ChatMessage = {
          id: nextId('error'),
          role: 'buddy',
          kind: 'error',
          text: toUserFacingMessage(rawMsg),
        };
        setMessages((prev) => [...prev, errMsg]);
      } finally {
        setApplying(false);
        scrollToEnd();
      }
    },
    [bump, scrollToEnd],
  );

  const handleVoiceResult = useCallback(
    (transcript: string) => {
      void sendUserMessage(transcript);
    },
    [sendUserMessage],
  );

  const { language } = useLocale();

  const {
    supported: voiceSupported,
    error: voiceError,
    isRecording,
    listening,
    paused,
    durationLabel,
    transcript: voiceTranscript,
    startRecording,
    pauseRecording,
    resumeRecording,
    cancelRecording,
    submitRecording,
  } = useVoiceInput({
    onResult: handleVoiceResult,
    lang: speechLocaleFromAppLang(language),
  });

  useEffect(() => {
    if (!visible) {
      initialSentRef.current = false;
      cancelRecording();
      return;
    }
    setDraft('');
    setMessages([
      { id: nextId('welcome'), role: 'buddy', kind: 'text', text: BUDDY_WELCOME },
      { id: nextId('suggestions'), role: 'buddy', kind: 'suggestions' },
    ]);
    initialSentRef.current = false;
  }, [visible, cancelRecording]);

  useEffect(() => {
    if (!visible) return;
    const trimmed = clampWhatsAppMessageText(initialText);
    if (!trimmed || initialSentRef.current) return;
    initialSentRef.current = true;
    void sendUserMessage(trimmed);
  }, [visible, initialText, sendUserMessage]);

  useEffect(() => {
    if (!voiceError) return;
    const errMsg: ChatMessage = {
      id: nextId('voice-error'),
      role: 'buddy',
      kind: 'error',
      text: voiceError,
    };
    setMessages((prev) => [...prev, errMsg]);
    scrollToEnd();
  }, [voiceError, scrollToEnd]);

  const busy = parsing || applying;

  return (
    <BottomSheet
      visible={visible}
      onDismiss={onDismiss}
      dismissDisabled={busy}
      title="AI Buddy"
      subtitle="Your kitchen assistant"
      scrollable={false}
      maxHeightRatio={0.92}
      sheetStyle={styles.sheet}
      footerStyle={styles.composerFooter}
      footer={(
        <BuddyChatComposer
          value={draft}
          onChangeText={setDraft}
          onSubmit={() => void sendUserMessage(draft)}
          placeholder="Message your kitchen buddy…"
          disabled={busy}
          loading={parsing}
          voiceSupported={voiceSupported}
          isRecording={isRecording}
          listening={listening}
          paused={paused}
          durationLabel={durationLabel}
          voiceTranscript={voiceTranscript}
          onStartRecording={() => void startRecording()}
          onPauseRecording={pauseRecording}
          onResumeRecording={() => void resumeRecording()}
          onCancelRecording={cancelRecording}
          onSubmitRecording={submitRecording}
        />
      )}
    >
      <View style={styles.chatContainer}>
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => item.id}
          style={styles.chatList}
          contentContainerStyle={styles.chatContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          onContentSizeChange={scrollToEnd}
          renderItem={({ item }) => (
            <ChatBubble
              message={item}
              onApply={(id) => void handleApply(id)}
              onPickPrompt={(t) => void sendUserMessage(t)}
            />
          )}
        />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheet: {
    minHeight: SCREEN_HEIGHT * 0.72,
  },
  composerFooter: {
    borderTopWidth: 0,
    elevation: 0,
    paddingTop: 8,
  },
  chatContainer: {
    height: SCREEN_HEIGHT * 0.52,
  },
  chatList: {
    flex: 1,
  },
  chatContent: {
    paddingBottom: 12,
    gap: 10,
  },
  userRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  userBubble: {
    maxWidth: '80%',
    backgroundColor: palette.primary,
    borderRadius: 20,
    borderBottomRightRadius: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  userText: {
    color: '#fff',
    lineHeight: 22,
  },
  buddyRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    maxWidth: '94%',
  },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: palette.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
    borderWidth: 1,
    borderColor: palette.primaryContainerDark,
  },
  buddyBubble: {
    flex: 1,
    backgroundColor: '#F3F4F3',
    borderRadius: 20,
    borderBottomLeftRadius: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
  },
  buddyText: {
    color: palette.text,
    lineHeight: 22,
  },
  typingBubble: {
    flex: 0,
    paddingVertical: 14,
    paddingHorizontal: 18,
  },
  typingDots: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: palette.textMuted,
    opacity: 0.5,
  },
  dotMid: {
    opacity: 0.8,
  },
  errorBubble: {
    backgroundColor: palette.errorBg,
  },
  errorText: {
    color: palette.error,
  },
  successBubble: {
    backgroundColor: palette.primaryContainer,
    borderWidth: 1,
    borderColor: palette.primaryContainerDark,
  },
  successText: {
    color: palette.primaryDark,
    fontWeight: '600',
  },
  suggestionsBubble: {
    backgroundColor: 'transparent',
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  suggestionsWrap: {
    gap: 8,
  },
  suggestionsLabel: {
    color: palette.textMuted,
    marginLeft: 4,
  },
  suggestionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  suggestionChip: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: palette.primaryContainerDark,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
    maxWidth: '48%',
  },
  suggestionChipPressed: {
    backgroundColor: palette.primaryContainerLight,
  },
  suggestionText: {
    color: palette.primaryDark,
    lineHeight: 16,
  },
  taskList: {
    gap: 6,
  },
  taskChip: {
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: palette.borderLight,
  },
  taskChipText: {
    color: palette.text,
    lineHeight: 18,
    fontWeight: '500',
  },
  proposalActions: {
    marginTop: 2,
  },
  confirmBtn: {
    borderRadius: 12,
  },
  confirmedLabel: {
    color: palette.primary,
    fontWeight: '700',
  },
});
