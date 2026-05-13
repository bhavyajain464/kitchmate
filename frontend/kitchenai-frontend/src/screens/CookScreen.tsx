import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  View,
  ScrollView,
  RefreshControl,
  Alert,
  Platform,
  Pressable,
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
  const [cookProfile, setCookProfile] = useState<CookProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

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
      const profile = await api.fetchCookProfile();
      setCookProfile(profile);
    } catch {
      setCookProfile(null);
    } finally {
      setProfileLoading(false);
    }
  }, []);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadProfile();
    setRefreshing(false);
  }, [loadProfile]);

  const dishesKnown = cookProfile?.dishes_known || [];

  const handleSendToCook = async () => {
    const dish = dishName.trim();
    if (!dish) return;

    setSending(true);
    try {
      const ingredients = [{ name: dish, quantity: 1, unit: 'dish' }];
      await api.sendMealSuggestion(dish, ingredients, 30);

      const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      setSentMessages((prev) => [{ dish, instructions: instructions.trim(), time: now }, ...prev]);

      const msg = `Sent "${dish}" to cook!`;
      Platform.OS === 'web' ? window.alert(msg) : Alert.alert('Sent!', msg);
      setDishName('');
      setInstructions('');
    } catch {
      const msg = 'Could not send to cook. Check WhatsApp setup.';
      Platform.OS === 'web' ? window.alert(msg) : Alert.alert('Failed', msg);
    } finally {
      setSending(false);
    }
  };

  const isKnown = (dish: string) =>
    dishesKnown.some((d) => d.toLowerCase().includes(dish.toLowerCase()) || dish.toLowerCase().includes(d.toLowerCase()));

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scrollContent}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={styles.header}>
        <IconButton icon="chef-hat" iconColor="rgba(255,255,255,0.4)" size={40} style={styles.headerBg} />
        <Text variant="headlineSmall" style={styles.headerTitle}>Cook Communication</Text>
        <Text variant="bodyMedium" style={styles.headerSub}>Send dish instructions via WhatsApp</Text>
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
          Send to Cook
        </Button>
      </Surface>

      {/* Cook Profile */}
      <Surface style={styles.profileCard} elevation={1}>
        <View style={styles.profileHeader}>
          <View style={styles.profileAvatar}>
            <IconButton icon="account-circle" iconColor="#fff" size={24} style={{ margin: 0 }} />
          </View>
          <Text variant="titleSmall" style={styles.profileTitle}>Cook Profile</Text>
        </View>

        {profileLoading ? (
          <ActivityIndicator style={{ marginVertical: 16 }} />
        ) : cookProfile ? (
          <View style={styles.profileBody}>
            <View style={styles.profileRow}>
              <Text variant="bodyMedium" style={styles.profileLabel}>Language</Text>
              <Chip compact style={styles.langChip}>
                {cookProfile.preferred_lang === 'hi' ? 'Hindi' : cookProfile.preferred_lang === 'kn' ? 'Kannada' : 'English'}
              </Chip>
            </View>
            {cookProfile.phone_number ? (
              <View style={styles.profileRow}>
                <Text variant="bodyMedium" style={styles.profileLabel}>WhatsApp</Text>
                <Text variant="bodyMedium" style={styles.phoneText}>{cookProfile.phone_number}</Text>
              </View>
            ) : (
              <Text variant="bodySmall" style={styles.noPhone}>
                No phone number set. Update cook profile to enable WhatsApp.
              </Text>
            )}
          </View>
        ) : (
          <Text variant="bodyMedium" style={styles.noProfile}>No cook profile set up.</Text>
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
  profileHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 10 },
  profileAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#128C7E', justifyContent: 'center', alignItems: 'center' },
  profileTitle: { fontWeight: '700', color: '#333' },
  profileBody: { gap: 8 },
  profileRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  profileLabel: { color: '#888' },
  langChip: { backgroundColor: '#E8F5E9' },
  phoneText: { color: '#25D366', fontWeight: '600' },
  noPhone: { color: '#E65100' },
  noProfile: { color: '#999' },

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
