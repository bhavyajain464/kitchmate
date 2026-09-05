import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  StyleSheet,
  View,
  ScrollView,
  RefreshControl,
  Platform,
  Pressable,
  KeyboardAvoidingView,
} from 'react-native';
import {
  Text,
  TextInput,
  IconButton,
  Chip,
  Surface,
  Button,
  ActivityIndicator,
  Icon,
} from 'react-native-paper';
import { useRoute, useFocusEffect, useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import * as api from '../services/api';
import { showAppError, showAppInfo, showAppSuccess } from '../utils/alertMessage';
import { buildWaMeUrl, isIosHomeScreenWeb, openWhatsAppUrl } from '../utils/openWhatsApp';
import { CookedLogEntry, CookProfile } from '../types';
import { useTabBarLayout } from '../hooks/useTabBarLayout';
import { useScrollToTopOnTabFocus } from '../hooks/useScrollToTopOnTabFocus';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { keyboardAvoidingBehavior, keyboardAwareScrollViewProps } from '../utils/keyboardAvoidance';
import { TabScreenHeader, TabScreenToolbarRow } from '../components/TabScreenHeader';
import { MessageComposer } from '../components/MessageComposer';
import { BottomSheet, bottomSheetInput, bottomSheetPrimaryBtn } from '../components/BottomSheet';
import {
  buildCookMessage,
  buildCookMessageForItems,
  COOK_MESSAGE_LANG_OPTIONS,
  cookLanguageLabel,
  cookMessagePlaceholder,
  formatCookMessageForDisplay,
  normalizeCookLang,
  type CookMessageLang,
} from '../utils/cookMessageTemplates';
import { TourTarget } from '../components/tour/TourTarget';
import { useProductTour } from '../context/ProductTourContext';
import { APP_TOUR_TARGET_IDS } from '../tour/appTourSteps';
import { useTourScreenScroll } from '../hooks/useTourScreenScroll';
import { CookModeToggle } from '../components/CookModeToggle';
import { CookingRecipesPanel } from '../components/CookingRecipesPanel';
import { normalizeCookMode, type CookRouteParams, type CookScreenMode } from '../navigation/cookParams';
import type { MainTabParamList } from '../navigation/types';

const COOK_ACCENT = '#2E7D32';
const COOK_BORDER = '#C8E6C9';

function primaryDishFromMessage(message: string): string {
  const line = message.trim().split('\n')[0]?.trim() || '';
  return line.split(/[,;]/)[0]?.trim() || line;
}

export function CookScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const route = useRoute<{ key: string; name: string; params?: CookRouteParams }>();
  const navigation = useNavigation<BottomTabNavigationProp<MainTabParamList, 'Cook'>>();
  const { contentPaddingBottom } = useTabBarLayout();
  const scrollRef = useRef<ScrollView>(null);
  const consumedCookingNavAt = useRef(0);
  useTourScreenScroll('Cook', scrollRef, { fixedChromeExtra: 260 });
  useScrollToTopOnTabFocus(scrollRef);
  const { isTourActive, activeStepId, requestTargetRemeasure } = useProductTour();
  const onCookComposerTourStep = isTourActive && activeStepId === 'cook-composer';
  const onCookRecipesTourStep = isTourActive && activeStepId === 'cook-recipes';
  const onCookTourStep = onCookComposerTourStep || onCookRecipesTourStep;
  const [screenMode, setScreenMode] = useState<CookScreenMode>('cook');
  const [cookingSearch, setCookingSearch] = useState('');
  const [expandDishId, setExpandDishId] = useState('');
  const [cookingIntentToken, setCookingIntentToken] = useState(0);
  const [cookProfile, setCookProfile] = useState<CookProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [cookNameDraft, setCookNameDraft] = useState('');
  const [phoneDraft, setPhoneDraft] = useState('');
  const [langDraft, setLangDraft] = useState<CookMessageLang>('en');
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [pendingSendAfterSave, setPendingSendAfterSave] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);

  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [cookMessages, setCookMessages] = useState<CookedLogEntry[]>([]);
  const [whatsappFallbackUrl, setWhatsappFallbackUrl] = useState<string | null>(null);

  const applyRouteParams = useCallback(() => {
    const params = route.params;
    const navAt = params?.at ?? 0;
    const dishId = params?.dishId?.trim() ?? '';
    const dishName = params?.dishName?.trim() ?? '';

    // Only apply mode when explicitly passed — clearing dish params must not flip back to message-cook mode.
    if (params?.mode == null) return;

    const nextMode = normalizeCookMode(params.mode);
    setScreenMode(nextMode);

    if (nextMode === 'cooking' && navAt > consumedCookingNavAt.current) {
      consumedCookingNavAt.current = navAt;
      setCookingIntentToken(navAt);
      setCookingSearch(dishName);
      setExpandDishId(dishId);
    }

    if (!cookProfile?.configured || nextMode !== 'cook') return;
    const rawItems = params?.dishItems;
    if (Array.isArray(rawItems) && rawItems.length > 0) {
      const items = rawItems.map((x) => String(x).trim()).filter(Boolean);
      if (items.length > 0) {
        setMessage(buildCookMessageForItems(items, cookProfile.preferred_lang));
        return;
      }
    }
    if (dishName) {
      setMessage(buildCookMessage(dishName, cookProfile.preferred_lang));
    }
  }, [
    route.params,
    cookProfile?.configured,
    cookProfile?.preferred_lang,
  ]);

  const clearCookingNavigationIntent = useCallback(() => {
    setCookingSearch('');
    setExpandDishId('');
    setCookingIntentToken(0);
    navigation.setParams({
      dishId: undefined,
      dishName: undefined,
      dishItems: undefined,
      at: undefined,
    } as CookRouteParams);
  }, [navigation]);

  useFocusEffect(
    useCallback(() => {
      if (isTourActive && onCookTourStep) return undefined;
      applyRouteParams();
      return undefined;
    }, [activeStepId, applyRouteParams, isTourActive, onCookTourStep]),
  );

  // Re-apply when Meals (or elsewhere) navigates here with new params while Cook is already focused.
  useEffect(() => {
    if (isTourActive && onCookTourStep) return;
    applyRouteParams();
  }, [activeStepId, applyRouteParams, isTourActive, onCookTourStep, route.params]);

  useEffect(() => {
    if (onCookComposerTourStep) {
      setScreenMode('cook');
    } else if (onCookRecipesTourStep) {
      setScreenMode('cooking');
    }
  }, [onCookComposerTourStep, onCookRecipesTourStep]);

  useEffect(() => {
    if (!onCookComposerTourStep || profileLoading) return;
    requestTargetRemeasure(APP_TOUR_TARGET_IDS.cookComposer);
  }, [onCookComposerTourStep, profileLoading, requestTargetRemeasure]);

  const loadProfile = useCallback(async () => {
    try {
      setProfileLoading(true);
      setProfileError('');
      const profile = await api.fetchCookProfile();
      setCookProfile(profile);
    } catch (error) {
      console.warn('Failed to load cook profile:', error);
      setProfileError('Could not load cook profile.');
      setCookProfile(null);
    } finally {
      setProfileLoading(false);
    }
  }, []);

  const loadCookMessages = useCallback(async () => {
    try {
      const res = await api.getCookMessages();
      setCookMessages(res.messages || []);
    } catch {
      setCookMessages([]);
    }
  }, []);

  useEffect(() => {
    loadProfile();
    loadCookMessages();
  }, [loadProfile, loadCookMessages]);

  useEffect(() => {
    if (!cookProfile) return;
    setCookNameDraft(cookProfile.cook_name ?? '');
    setPhoneDraft(cookProfile.phone_number ?? '');
    setLangDraft(normalizeCookLang(cookProfile.preferred_lang));
  }, [cookProfile]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadProfile(), loadCookMessages()]);
    setRefreshing(false);
  }, [loadProfile, loadCookMessages]);

  const profileHasPhone = Boolean(cookProfile?.phone_number?.trim());
  const canMessageCook =
    !profileLoading && !profileError && Boolean(cookProfile?.configured && profileHasPhone);

  const activeCookLang = normalizeCookLang(
    isEditingProfile ? langDraft : cookProfile?.preferred_lang,
  );

  const formatStoredAt = (date?: string) => {
    if (!date) return 'Not available';
    const parsed = new Date(date);
    if (Number.isNaN(parsed.getTime())) return 'Not available';
    return parsed.toLocaleString([], {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const cookMessageBody = (entry: CookedLogEntry) =>
    formatCookMessageForDisplay(entry.notes, entry.dish_name);

  const cookMessageTime = (entry: CookedLogEntry) => {
    if (!entry.created_at) return '';
    return formatStoredAt(entry.created_at);
  };

  const openCookEditor = () => {
    setIsEditingProfile(true);
  };

  const profileDetailLine = () => {
    if (profileLoading) return 'Loading…';
    if (profileError) return 'Could not load — tap Retry below';
    if (!profileHasPhone) return 'Add WhatsApp number to send messages';
    const parts = [
      cookProfile?.cook_name?.trim(),
      cookProfile?.phone_number?.trim(),
      cookLanguageLabel(cookProfile?.preferred_lang),
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(' · ') : 'Not set up yet';
  };

  const closeCookEditor = () => {
    setPendingSendAfterSave(false);
    setIsEditingProfile(false);
    setCookNameDraft(cookProfile?.cook_name ?? '');
    setPhoneDraft(cookProfile?.phone_number ?? '');
    setLangDraft(normalizeCookLang(cookProfile?.preferred_lang));
  };

  const handleSaveCookProfile = async () => {
    const dishes = cookProfile?.dishes_known ?? [];
    setSavingProfile(true);
    try {
      await api.updateCookProfile({
        cook_name: cookNameDraft.trim(),
        dishes_known: dishes,
        preferred_lang: langDraft,
        phone_number: phoneDraft.trim(),
      });
      await loadProfile();
      setIsEditingProfile(false);
      const shouldSendAfterSave = pendingSendAfterSave && message.trim() && phoneDraft.trim();
      setPendingSendAfterSave(false);
      showAppSuccess(
        shouldSendAfterSave
          ? 'Cook profile saved. Opening WhatsApp with your draft.'
          : 'Cook profile saved.',
      );
      if (shouldSendAfterSave) {
        await sendCurrentMessageToCook();
      }
    } catch {
      showAppError('Could not save cook profile.');
    } finally {
      setSavingProfile(false);
    }
  };

  const dishesKnown = cookProfile?.dishes_known || [];

  const sendCurrentMessageToCook = async () => {
    const text = message.trim();
    const phone = cookProfile?.phone_number?.trim();
    if (!text || !phone) return;

    const waUrl = buildWaMeUrl(phone, text);
    if (!waUrl) {
      showAppError('Could not build a WhatsApp link. Check the cook number (include country code, e.g. +91…).');
      return;
    }

    setSending(true);
    const dishName = primaryDishFromMessage(text);

    // Open immediately while the tap gesture is still active (required on iOS home-screen web).
    openWhatsAppUrl(waUrl);
    if (Platform.OS === 'web' && isIosHomeScreenWeb()) {
      setWhatsappFallbackUrl(waUrl);
    } else {
      setWhatsappFallbackUrl(null);
    }

    try {
      await api.sendWhatsAppMessage(phone, text, dishName);
      setMessage('');
      await loadCookMessages();
    } catch {
      showAppInfo(
        Platform.OS === 'web' && isIosHomeScreenWeb()
          ? 'If WhatsApp did not open, use the link below.'
          : 'Could not sync with server. WhatsApp may still have opened with your draft.',
      );
      setMessage('');
      await loadCookMessages();
    } finally {
      setSending(false);
    }
  };

  const handleSendToCook = async () => {
    if (!canMessageCook) {
      setPendingSendAfterSave(Boolean(message.trim()));
      openCookEditor();
      showAppInfo('Add your cook profile with a WhatsApp number before sending messages.');
      return;
    }
    if (!message.trim()) return;
    await sendCurrentMessageToCook();
  };

  const profileSheetSubtitle = pendingSendAfterSave
    ? 'Save the cook number to continue sending your current message.'
    : 'Name, WhatsApp number, and message language for your cook.';

  return (
    <>
    <KeyboardAvoidingView
      style={styles.root}
      behavior={keyboardAvoidingBehavior()}
      keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}
    >
    <View style={styles.root}>
      <TabScreenHeader
        title={t('cook.title')}
        decoration={
          <IconButton icon="chef-hat" iconColor="rgba(255,255,255,0.4)" size={40} style={styles.headerBg} />
        }
      />

      <View style={styles.toggleRow}>
        <CookModeToggle value={screenMode} onChange={setScreenMode} />
      </View>

      {screenMode === 'cook' ? (
      <>
      <TabScreenToolbarRow block style={styles.toolbarChrome}>
        <TourTarget id={APP_TOUR_TARGET_IDS.cookComposer}>
          <Surface style={styles.composeCard} elevation={1}>
          <View style={styles.sendTitleRow}>
            <View style={styles.sendTitleIcon}>
              <Icon source="message-text-outline" size={18} color={COOK_ACCENT} />
            </View>
            <View style={styles.sendTitleText}>
              <Text variant="titleSmall" style={styles.sendTitle}>
                Message your cook
              </Text>
            </View>
          </View>

          {!canMessageCook && !profileLoading ? (
            <Surface style={styles.blockedPrompt} elevation={0}>
              <IconButton icon="account-plus" iconColor="#E65100" size={18} style={{ margin: 0 }} />
              <Text variant="bodySmall" style={styles.blockedPromptText}>
                Open Cook profile below to add a WhatsApp number.
              </Text>
            </Surface>
          ) : null}

          <MessageComposer
            value={message}
            onChangeText={canMessageCook ? setMessage : () => {}}
            onSubmit={handleSendToCook}
            placeholder={
              canMessageCook
                ? cookMessagePlaceholder(activeCookLang)
                : 'Set up cook profile to message'
            }
            loading={sending}
            disabled={!canMessageCook || sending}
            accentColor={COOK_ACCENT}
            borderColor={COOK_BORDER}
            accessibilityLabel="Send message"
            showSubmitButton={false}
          />

          {whatsappFallbackUrl ? (
            <Pressable
              onPress={() => openWhatsAppUrl(whatsappFallbackUrl)}
              style={styles.waFallback}
              accessibilityRole="link"
              accessibilityLabel="Open WhatsApp"
            >
              <Text variant="bodySmall" style={styles.waFallbackText}>
                WhatsApp didn&apos;t open? Tap here to open your message
              </Text>
            </Pressable>
          ) : null}
          </Surface>
        </TourTarget>
      </TabScreenToolbarRow>

      <ScrollView
        ref={scrollRef}
        style={styles.container}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: contentPaddingBottom(56) }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        showsVerticalScrollIndicator={false}
        {...keyboardAwareScrollViewProps}
      >
      {/* Cook profile — compact row; edit opens bottom sheet */}
        <Surface style={styles.profileCard} elevation={1}>
        <View style={styles.profileHeader}>
          <View style={styles.profileHeaderLeft}>
            <View style={styles.profileAvatar}>
              <IconButton icon="account-circle" iconColor="#fff" size={24} style={{ margin: 0 }} />
            </View>
            <View style={styles.profileHeaderText}>
              <Text variant="titleSmall" style={styles.profileTitle}>Cook profile</Text>
              <Text
                variant="bodySmall"
                style={[
                  styles.profileDetailLine,
                  !profileHasPhone && !profileLoading && !profileError
                    ? styles.profileDetailLineWarn
                    : null,
                ]}
                numberOfLines={2}
              >
                {profileDetailLine()}
              </Text>
            </View>
          </View>
          {!profileLoading && !profileError ? (
            <Button mode="text" compact icon="pencil" onPress={openCookEditor}>
              {profileHasPhone || cookProfile?.cook_name ? 'Edit' : 'Add'}
            </Button>
          ) : null}
        </View>

        {profileLoading ? (
          <ActivityIndicator style={styles.profileLoader} />
        ) : profileError ? (
          <View style={styles.profileErrorBody}>
            <Surface style={styles.loadErrorPrompt} elevation={0}>
              <IconButton icon="cloud-alert-outline" iconColor="#B71C1C" size={18} style={{ margin: 0 }} />
              <Text variant="bodySmall" style={styles.loadErrorText}>
                Could not load cook profile. Tap Retry below.
              </Text>
            </Surface>
            <Button mode="contained-tonal" icon="refresh" onPress={loadProfile}>
              Retry
            </Button>
          </View>
        ) : null}
      </Surface>

      {/* Recent messages — below profile; unchanged when sheet opens */}
      {cookMessages.length > 0 && (
        <View style={styles.historyWrap}>
          <Text variant="titleSmall" style={styles.historyLabel}>Recent messages to cook</Text>
          {cookMessages.map((entry) => (
            <Surface key={entry.id} style={styles.historyCard} elevation={0}>
              <View style={styles.historyDot} />
              <Text variant="bodyMedium" style={styles.historyDish} numberOfLines={4}>
                {cookMessageBody(entry)}
              </Text>
              <Text variant="labelSmall" style={styles.historyTime}>
                {cookMessageTime(entry)}
              </Text>
            </Surface>
          ))}
        </View>
      )}

      {/* Dishes Known */}
      {dishesKnown.length > 0 && (
        <Surface style={styles.dishesCard} elevation={1}>
          <Text variant="titleSmall" style={styles.cardLabel}>
            Dishes Cook Knows ({dishesKnown.length})
          </Text>
          <View style={styles.dishesGrid}>
            {dishesKnown.map((dish, i) => (
              <Pressable
                key={i}
                onPress={() => canMessageCook && setMessage(buildCookMessage(dish, activeCookLang))}
                disabled={!canMessageCook}
              >
                <Chip compact icon="check" style={styles.dishChip} textStyle={styles.dishChipText}>{dish}</Chip>
              </Pressable>
            ))}
          </View>
          <Text variant="bodySmall" style={styles.dishHint}>Tap a dish to pre-fill</Text>
        </Surface>
      )}

      <View style={{ height: 32 }} />
      </ScrollView>
      </>
      ) : (
        <View style={styles.recipesBody}>
        <CookingRecipesPanel
          intentToken={cookingIntentToken}
          initialSearch={cookingSearch}
          expandDishId={expandDishId}
          contentPaddingBottom={contentPaddingBottom(56)}
          tourRecipesStep={onCookRecipesTourStep}
          onIntentConsumed={clearCookingNavigationIntent}
        />
        </View>
      )}
    </View>
    </KeyboardAvoidingView>

    <BottomSheet
      visible={isEditingProfile}
      onDismiss={closeCookEditor}
      dismissDisabled={savingProfile}
      title={pendingSendAfterSave ? 'Set up cook to send' : 'Cook profile'}
      subtitle={profileSheetSubtitle}
      maxHeightRatio={0.82}
      footer={(
        <Button
          mode="contained"
          icon="content-save"
          onPress={() => void handleSaveCookProfile()}
          loading={savingProfile}
          disabled={savingProfile}
          buttonColor={COOK_ACCENT}
          style={bottomSheetPrimaryBtn.button}
          contentStyle={bottomSheetPrimaryBtn.content}
          labelStyle={bottomSheetPrimaryBtn.label}
        >
          {pendingSendAfterSave ? 'Save and send' : 'Save cook profile'}
        </Button>
      )}
    >
      <TextInput
        mode="outlined"
        label="Cook name"
        placeholder="e.g. Priya"
        value={cookNameDraft}
        onChangeText={setCookNameDraft}
        style={bottomSheetInput}
        dense
        outlineColor="#E0E0E0"
        activeOutlineColor={COOK_ACCENT}
        outlineStyle={{ borderRadius: 12 }}
      />
      <TextInput
        mode="outlined"
        label="WhatsApp number"
        placeholder="+919876543210 (include country code)"
        value={phoneDraft}
        onChangeText={setPhoneDraft}
        keyboardType="phone-pad"
        style={bottomSheetInput}
        dense
        outlineColor="#E0E0E0"
        activeOutlineColor="#25D366"
        outlineStyle={{ borderRadius: 12 }}
      />
      <Text variant="labelMedium" style={styles.langLabel}>Message language</Text>
      <View style={styles.langRow}>
        {COOK_MESSAGE_LANG_OPTIONS.map(({ code, label }) => (
          <Chip
            key={code}
            selected={langDraft === code}
            onPress={() => setLangDraft(code)}
            style={langDraft === code ? styles.langChipActive : styles.langChipPick}
            textStyle={langDraft === code ? styles.langChipTextActive : undefined}
          >
            {label}
          </Chip>
        ))}
      </View>
      {!cookProfile?.phone_number?.trim() && !phoneDraft.trim() ? (
        <Text variant="bodySmall" style={styles.noPhone}>
          Add a WhatsApp number so your message can be sent via WhatsApp.
        </Text>
      ) : null}
    </BottomSheet>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FAFAFA' },
  container: { flex: 1, zIndex: 0 },
  scrollContent: { paddingTop: 4, paddingBottom: 24 },

  headerBg: { position: 'absolute', top: 8, right: 8, opacity: 0.15 },

  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    zIndex: 2,
  },

  recipesBody: {
    flex: 1,
    minHeight: 0,
  },

  toolbarChrome: {
    zIndex: 2,
    elevation: 4,
    backgroundColor: '#FAFAFA',
    gap: 10,
    marginTop: 0,
  },

  composeCard: {
    alignSelf: 'stretch',
    borderRadius: 14,
    backgroundColor: '#fff',
    padding: 14,
    borderWidth: 1,
    borderColor: '#C8E6C9',
  },
  sendTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  sendTitleIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#E8F5E9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendTitleText: { flex: 1 },
  sendTitle: { fontWeight: '700', color: '#1A1A1A' },
  cardLabel: { fontWeight: '700', color: '#333', marginBottom: 12 },

  blockedPrompt: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF3E0',
    borderRadius: 12,
    padding: 10,
    gap: 4,
    marginBottom: 10,
  },
  blockedPromptText: { color: '#E65100', flex: 1, lineHeight: 18 },
  waFallback: {
    marginTop: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#E8F5E9',
    borderWidth: 1,
    borderColor: '#A5D6A7',
  },
  waFallbackText: { color: '#25D366', fontWeight: '600', textAlign: 'center' },

  profileCard: {
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 16,
    backgroundColor: '#fff',
    padding: 16,
  },
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  profileHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  profileHeaderText: { flex: 1 },
  profileAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#2E7D32', justifyContent: 'center', alignItems: 'center' },
  profileTitle: { fontWeight: '700', color: '#333' },
  profileDetailLine: { color: '#666', marginTop: 2, lineHeight: 17 },
  profileDetailLineWarn: { color: '#E65100' },
  profileLoader: { marginTop: 12 },
  profileErrorBody: { gap: 10, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#EEE' },
  loadErrorPrompt: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFEBEE',
    borderRadius: 12,
    padding: 10,
    gap: 4,
  },
  loadErrorText: { color: '#B71C1C', flex: 1, lineHeight: 18 },
  langLabel: { color: '#888', marginTop: 4 },
  langRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  langChipPick: { backgroundColor: '#F0F0F0' },
  langChipActive: { backgroundColor: '#2E7D32' },
  langChipTextActive: { color: '#fff' },
  noPhone: { color: '#E65100', marginTop: 4 },

  dishesCard: {
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 16,
    backgroundColor: '#fff',
    padding: 16,
  },
  dishesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  dishChip: { backgroundColor: '#E8F5E9' },
  dishChipText: { fontSize: 12, color: '#2E7D32' },
  dishHint: { color: '#bbb', marginTop: 10, fontStyle: 'italic', fontSize: 12 },

  historyWrap: { paddingHorizontal: 16, marginTop: 12 },
  historyLabel: { fontWeight: '700', color: '#555', marginBottom: 10 },
  historyCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#F5F5F5',
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    gap: 10,
  },
  historyDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#25D366',
    marginTop: 6,
  },
  historyDish: { flex: 1, fontWeight: '600', color: '#333', lineHeight: 20 },
  historyTime: { color: '#888', flexShrink: 0, marginTop: 2, maxWidth: '34%', textAlign: 'right' },
});
