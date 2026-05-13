import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  StyleSheet,
  View,
  ScrollView,
  type ScrollView as ScrollViewType,
  RefreshControl,
  Alert,
  Platform,
  Pressable,
  Linking,
} from 'react-native';
import {
  Text,
  TextInput,
  IconButton,
  Chip,
  Surface,
  Button,
  ActivityIndicator,
} from 'react-native-paper';
import { useRoute } from '@react-navigation/native';
import * as api from '../services/api';
import { CookProfile } from '../types';

interface SentMessage {
  dish: string;
  instructions: string;
  time: string;
}

export function CookScreen() {
  const route = useRoute<any>();
  const scrollRef = useRef<ScrollViewType>(null);
  const [cookProfile, setCookProfile] = useState<CookProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [cookNameDraft, setCookNameDraft] = useState('');
  const [phoneDraft, setPhoneDraft] = useState('');
  const [langDraft, setLangDraft] = useState('en');
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [pendingSendAfterSave, setPendingSendAfterSave] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);

  const [dishName, setDishName] = useState('');
  const [instructions, setInstructions] = useState('');
  const [sending, setSending] = useState(false);
  const [sentMessages, setSentMessages] = useState<SentMessage[]>([]);

  useEffect(() => {
    if (route.params?.dishName) setDishName(route.params.dishName);
    if (route.params?.instructions) setInstructions(route.params.instructions);
  }, [route.params?.dishName, route.params?.instructions]);

  const loadProfile = useCallback(async () => {
    try {
      setProfileLoading(true);
      setProfileError('');
      const profile = await api.fetchCookProfile();
      setCookProfile(profile);
    } catch (error) {
      console.warn('Failed to load cook profile:', error);
      setProfileError('Could not load cook profile from the API.');
      setCookProfile(null);
    } finally {
      setProfileLoading(false);
    }
  }, []);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  useEffect(() => {
    if (!cookProfile) return;
    setCookNameDraft(cookProfile.cook_name ?? '');
    setPhoneDraft(cookProfile.phone_number ?? '');
    setLangDraft(cookProfile.preferred_lang || 'en');
  }, [cookProfile]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadProfile();
    setRefreshing(false);
  }, [loadProfile]);

  const profileHasPhone = Boolean(cookProfile?.phone_number?.trim());

  const languageLabel = (code?: string) => {
    if (code === 'hi') return 'Hindi';
    if (code === 'kn') return 'Kannada';
    return 'English';
  };

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

  const openCookEditor = () => {
    setIsEditingProfile(true);
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ y: 260, animated: true }));
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
      const shouldSendAfterSave = pendingSendAfterSave && dishName.trim() && phoneDraft.trim();
      setPendingSendAfterSave(false);
      const msg = shouldSendAfterSave
        ? 'Cook profile saved. Opening WhatsApp with your draft.'
        : 'Cook profile saved. WhatsApp will use this name and number.';
      Platform.OS === 'web' ? window.alert(msg) : Alert.alert('Saved', msg);
      if (shouldSendAfterSave) {
        await sendCurrentDishToCook();
      }
    } catch {
      const msg = 'Could not save cook profile.';
      Platform.OS === 'web' ? window.alert(msg) : Alert.alert('Error', msg);
    } finally {
      setSavingProfile(false);
    }
  };

  const dishesKnown = cookProfile?.dishes_known || [];

  const sendCurrentDishToCook = async () => {
    const dish = dishName.trim();
    if (!dish) return;

    setSending(true);
    try {
      const ingredients = [{ name: dish, quantity: 1, unit: 'dish' }];
      const result = await api.sendMealSuggestion(dish, ingredients, 30, {
        instructions: instructions.trim() || undefined,
      });

      if (result.whatsapp_url) {
        if (Platform.OS === 'web') {
          window.open(result.whatsapp_url, '_blank', 'noopener,noreferrer');
        } else {
          await Linking.openURL(result.whatsapp_url);
        }
      }

      const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      setSentMessages((prev) => [{ dish, instructions: instructions.trim(), time: now }, ...prev]);

      const msg = result.whatsapp_url
        ? `WhatsApp opened with a draft for "${dish}". Send it from your phone when ready.`
        : `Prepared "${dish}" (no WhatsApp link returned).`;
      Platform.OS === 'web' ? window.alert(msg) : Alert.alert('Sent!', msg);
      setDishName('');
      setInstructions('');
    } catch {
      const msg = 'Could not prepare WhatsApp link. Save the cook WhatsApp number in Cook profile.';
      Platform.OS === 'web' ? window.alert(msg) : Alert.alert('Failed', msg);
    } finally {
      setSending(false);
    }
  };

  const handleSendToCook = async () => {
    const dish = dishName.trim();
    if (!dish) return;

    if (!profileHasPhone) {
      setPendingSendAfterSave(true);
      openCookEditor();
      const msg = 'Add the cook WhatsApp number first. After saving, this message will open in WhatsApp automatically.';
      Platform.OS === 'web' ? window.alert(msg) : Alert.alert('Add cook number', msg);
      return;
    }

    await sendCurrentDishToCook();
  };

  const isKnown = (dish: string) =>
    dishesKnown.some((d) => d.toLowerCase().includes(dish.toLowerCase()) || dish.toLowerCase().includes(d.toLowerCase()));

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.container}
      contentContainerStyle={styles.scrollContent}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={styles.header}>
        <IconButton icon="chef-hat" iconColor="rgba(255,255,255,0.4)" size={40} style={styles.headerBg} />
        <Text variant="headlineSmall" style={styles.headerTitle}>Cook Communication</Text>
        <Text variant="bodyMedium" style={styles.headerSub}>Open WhatsApp on your phone with a draft for the cook</Text>
      </View>

      {/* Send Instructions Card */}
      <Surface style={styles.sendCard} elevation={2}>
        <Text variant="titleSmall" style={styles.cardLabel}>What should the cook make?</Text>

        <TextInput
          mode="outlined"
          placeholder="Dish name, e.g. Paneer Butter Masala"
          value={dishName}
          onChangeText={setDishName}
          style={styles.input}
          dense
          outlineColor="#E0E0E0"
          activeOutlineColor="#25D366"
          outlineStyle={{ borderRadius: 12 }}
          left={<TextInput.Icon icon="food" color="#bbb" />}
        />

        {dishName.trim() !== '' && (
          <View style={styles.knownRow}>
            {isKnown(dishName) ? (
              <Surface style={[styles.knownBadge, { backgroundColor: '#E8F5E9' }]} elevation={0}>
                <IconButton icon="check-circle" iconColor="#2E7D32" size={16} style={{ margin: 0 }} />
                <Text style={styles.knownText}>Cook knows this dish</Text>
              </Surface>
            ) : (
              <Surface style={[styles.knownBadge, { backgroundColor: '#FFF3E0' }]} elevation={0}>
                <IconButton icon="alert-circle-outline" iconColor="#E65100" size={16} style={{ margin: 0 }} />
                <Text style={styles.unknownText}>Cook may not know this — add detailed instructions</Text>
              </Surface>
            )}
          </View>
        )}

        <TextInput
          mode="outlined"
          placeholder="Special instructions, e.g. make it spicy, less oil..."
          value={instructions}
          onChangeText={setInstructions}
          multiline
          numberOfLines={3}
          style={styles.input}
          outlineColor="#E0E0E0"
          activeOutlineColor="#25D366"
          outlineStyle={{ borderRadius: 12 }}
          left={<TextInput.Icon icon="message-text-outline" color="#bbb" />}
        />

        <Button
          mode="contained"
          icon="whatsapp"
          onPress={handleSendToCook}
          loading={sending}
          disabled={sending || !dishName.trim()}
          buttonColor="#25D366"
          style={styles.sendBtn}
          contentStyle={{ paddingVertical: 4 }}
        >
          Send to cook (WhatsApp)
        </Button>
      </Surface>

      {/* Cook Profile — name & number used for WhatsApp */}
      <Surface style={styles.profileCard} elevation={1}>
        <View style={styles.profileHeader}>
          <View style={styles.profileHeaderLeft}>
            <View style={styles.profileAvatar}>
              <IconButton icon="account-circle" iconColor="#fff" size={24} style={{ margin: 0 }} />
            </View>
            <View>
              <Text variant="titleSmall" style={styles.profileTitle}>Cook profile</Text>
              <Text variant="bodySmall" style={styles.profileSubtitle}>Persistent cook storage</Text>
            </View>
          </View>
          {!profileLoading && !profileError && !isEditingProfile ? (
            <Button mode="text" compact icon="pencil" onPress={openCookEditor}>
              {profileHasPhone || cookProfile?.cook_name ? 'Edit' : 'Add'}
            </Button>
          ) : null}
        </View>

        {profileLoading ? (
          <ActivityIndicator style={{ marginVertical: 16 }} />
        ) : profileError ? (
          <View style={styles.profileBody}>
            <Surface style={styles.loadErrorPrompt} elevation={0}>
              <IconButton icon="cloud-alert-outline" iconColor="#B71C1C" size={18} style={{ margin: 0 }} />
              <Text variant="bodySmall" style={styles.loadErrorText}>
                {profileError} Check that the frontend is using the same backend you logged into.
              </Text>
            </Surface>
            <Button mode="contained-tonal" icon="refresh" onPress={loadProfile}>
              Retry
            </Button>
          </View>
        ) : !isEditingProfile ? (
          <View style={styles.profileBody}>
            <View style={styles.detailGrid}>
              <View style={styles.detailItem}>
                <Text variant="labelSmall" style={styles.detailLabel}>Name</Text>
                <Text variant="bodyMedium" style={styles.detailValue}>
                  {cookProfile?.cook_name?.trim() || 'Not added'}
                </Text>
              </View>
              <View style={styles.detailItem}>
                <Text variant="labelSmall" style={styles.detailLabel}>WhatsApp</Text>
                <Text variant="bodyMedium" style={styles.detailValue}>
                  {cookProfile?.phone_number?.trim() || 'Not added'}
                </Text>
              </View>
              <View style={styles.detailItem}>
                <Text variant="labelSmall" style={styles.detailLabel}>Message language</Text>
                <Text variant="bodyMedium" style={styles.detailValue}>
                  {languageLabel(cookProfile?.preferred_lang)}
                </Text>
              </View>
              <View style={styles.detailItem}>
                <Text variant="labelSmall" style={styles.detailLabel}>Last updated</Text>
                <Text variant="bodyMedium" style={styles.detailValue}>
                  {formatStoredAt(cookProfile?.updated_at)}
                </Text>
              </View>
            </View>
            {profileHasPhone ? (
              <Surface style={styles.defaultRoute} elevation={0}>
                <IconButton icon="whatsapp" iconColor="#128C7E" size={18} style={{ margin: 0 }} />
                <Text variant="bodySmall" style={styles.defaultRouteText}>
                  WhatsApp drafts are sent to this saved number by default.
                </Text>
              </Surface>
            ) : (
              <Surface style={styles.addCookPrompt} elevation={0}>
                <IconButton icon="alert-circle-outline" iconColor="#E65100" size={18} style={{ margin: 0 }} />
                <Text variant="bodySmall" style={styles.addCookText}>
                  Add a cook WhatsApp number before sending messages.
                </Text>
              </Surface>
            )}
          </View>
        ) : (
          <View style={styles.profileBody}>
            <Text variant="bodySmall" style={styles.profileHint}>
              {pendingSendAfterSave
                ? 'Save the cook number to continue sending your current message.'
                : "Edit the stored cook details. WhatsApp drafts use this number by default."}
            </Text>
            <TextInput
              mode="outlined"
              label="Cook name"
              placeholder="e.g. Priya"
              value={cookNameDraft}
              onChangeText={setCookNameDraft}
              style={styles.input}
              dense
              outlineColor="#E0E0E0"
              activeOutlineColor="#128C7E"
              outlineStyle={{ borderRadius: 12 }}
            />
            <TextInput
              mode="outlined"
              label="WhatsApp number"
              placeholder="+919876543210 (include country code)"
              value={phoneDraft}
              onChangeText={setPhoneDraft}
              keyboardType="phone-pad"
              style={styles.input}
              dense
              outlineColor="#E0E0E0"
              activeOutlineColor="#25D366"
              outlineStyle={{ borderRadius: 12 }}
            />
            <Text variant="labelMedium" style={styles.langLabel}>Message language</Text>
            <View style={styles.langRow}>
              {(['en', 'hi', 'kn'] as const).map((code) => (
                <Chip
                  key={code}
                  selected={langDraft === code}
                  onPress={() => setLangDraft(code)}
                  style={langDraft === code ? styles.langChipActive : styles.langChipPick}
                  textStyle={langDraft === code ? styles.langChipTextActive : undefined}
                >
                  {code === 'en' ? 'English' : code === 'hi' ? 'Hindi' : 'Kannada'}
                </Chip>
              ))}
            </View>
            <Button
              mode="contained-tonal"
              icon="content-save"
              onPress={handleSaveCookProfile}
              loading={savingProfile}
              disabled={savingProfile}
              style={{ marginTop: 8, borderRadius: 12 }}
            >
              {pendingSendAfterSave ? 'Save and send' : 'Save cook profile'}
            </Button>
            <Button
              mode="text"
              onPress={() => {
                setPendingSendAfterSave(false);
                setIsEditingProfile(false);
                setCookNameDraft(cookProfile?.cook_name ?? '');
                setPhoneDraft(cookProfile?.phone_number ?? '');
                setLangDraft(cookProfile?.preferred_lang || 'en');
              }}
              disabled={savingProfile}
            >
              Cancel
            </Button>
            {!cookProfile?.phone_number?.trim() && !phoneDraft.trim() ? (
              <Text variant="bodySmall" style={styles.noPhone}>
                Add a WhatsApp number so "Send to Cook" can deliver messages.
              </Text>
            ) : null}
          </View>
        )}
      </Surface>

      {/* Dishes Known */}
      {dishesKnown.length > 0 && (
        <Surface style={styles.dishesCard} elevation={1}>
          <Text variant="titleSmall" style={styles.cardLabel}>
            Dishes Cook Knows ({dishesKnown.length})
          </Text>
          <View style={styles.dishesGrid}>
            {dishesKnown.map((dish, i) => (
              <Pressable key={i} onPress={() => setDishName(dish)}>
                <Chip compact icon="check" style={styles.dishChip} textStyle={styles.dishChipText}>{dish}</Chip>
              </Pressable>
            ))}
          </View>
          <Text variant="bodySmall" style={styles.dishHint}>Tap a dish to pre-fill</Text>
        </Surface>
      )}

      {/* Sent History */}
      {sentMessages.length > 0 && (
        <View style={styles.historyWrap}>
          <Text variant="titleSmall" style={styles.historyLabel}>Sent Today</Text>
          {sentMessages.map((msg, i) => (
            <Surface key={i} style={styles.historyCard} elevation={0}>
              <View style={styles.historyDot} />
              <View style={styles.historyInfo}>
                <Text variant="bodyMedium" style={styles.historyDish}>{msg.dish}</Text>
                {msg.instructions ? (
                  <Text variant="bodySmall" style={styles.historyInst} numberOfLines={2}>{msg.instructions}</Text>
                ) : null}
              </View>
              <Text variant="labelSmall" style={styles.historyTime}>{msg.time}</Text>
            </Surface>
          ))}
        </View>
      )}

      <View style={{ height: 32 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F9FA' },
  scrollContent: { paddingBottom: 24 },

  header: {
    backgroundColor: '#128C7E',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 24,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    overflow: 'hidden',
  },
  headerBg: { position: 'absolute', top: 8, right: 8, opacity: 0.15 },
  headerTitle: { color: '#fff', fontWeight: '800' },
  headerSub: { color: 'rgba(255,255,255,0.85)', marginTop: 4 },

  sendCard: {
    marginHorizontal: 20,
    marginTop: -12,
    borderRadius: 18,
    backgroundColor: '#fff',
    padding: 18,
  },
  cardLabel: { fontWeight: '700', color: '#333', marginBottom: 12 },
  input: { backgroundColor: '#fff', marginBottom: 10 },

  knownRow: { marginBottom: 10 },
  knownBadge: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 10, gap: 2 },
  knownText: { color: '#2E7D32', fontSize: 12, fontWeight: '600' },
  unknownText: { color: '#E65100', fontSize: 12, fontWeight: '600', flex: 1 },

  sendBtn: { borderRadius: 12, marginTop: 4 },

  profileCard: {
    marginHorizontal: 20,
    marginTop: 14,
    borderRadius: 16,
    backgroundColor: '#fff',
    padding: 16,
  },
  profileHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 10 },
  profileHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  profileAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#128C7E', justifyContent: 'center', alignItems: 'center' },
  profileTitle: { fontWeight: '700', color: '#333' },
  profileSubtitle: { color: '#888', marginTop: 1 },
  profileBody: { gap: 10 },
  profileHint: { color: '#666', marginBottom: 4, lineHeight: 18 },
  detailGrid: { gap: 10 },
  detailItem: {
    backgroundColor: '#F8F9FA',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#ECEFF1',
  },
  detailLabel: { color: '#888', marginBottom: 3, textTransform: 'uppercase', letterSpacing: 0 },
  detailValue: { color: '#263238', fontWeight: '600' },
  defaultRoute: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E8F5E9',
    borderRadius: 12,
    padding: 10,
    gap: 4,
  },
  defaultRouteText: { color: '#1B5E20', flex: 1, lineHeight: 18 },
  addCookPrompt: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF3E0',
    borderRadius: 12,
    padding: 10,
    gap: 4,
  },
  addCookText: { color: '#E65100', flex: 1, lineHeight: 18 },
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
  langChipActive: { backgroundColor: '#128C7E' },
  langChipTextActive: { color: '#fff' },
  noPhone: { color: '#E65100', marginTop: 4 },

  dishesCard: {
    marginHorizontal: 20,
    marginTop: 14,
    borderRadius: 16,
    backgroundColor: '#fff',
    padding: 16,
  },
  dishesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  dishChip: { backgroundColor: '#E8F5E9' },
  dishChipText: { fontSize: 12, color: '#2E7D32' },
  dishHint: { color: '#bbb', marginTop: 10, fontStyle: 'italic', fontSize: 12 },

  historyWrap: { paddingHorizontal: 20, marginTop: 20 },
  historyLabel: { fontWeight: '700', color: '#555', marginBottom: 10 },
  historyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F5F5F5',
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
  },
  historyDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#25D366', marginRight: 12 },
  historyInfo: { flex: 1 },
  historyDish: { fontWeight: '600', color: '#333' },
  historyInst: { color: '#888', marginTop: 2 },
  historyTime: { color: '#bbb' },
});
