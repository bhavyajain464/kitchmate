import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  Alert,
  Platform,
  Image,
  Pressable,
} from 'react-native';
import {
  Text,
  Card,
  Button,
  TextInput,
  Chip,
  Divider,
  IconButton,
  ActivityIndicator,
  SegmentedButtons,
  Surface,
} from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import { UserProfile, UserMemory } from '../types';
import * as api from '../services/api';
import { layout } from '../theme';

const SPICE_LEVELS = ['mild', 'medium', 'spicy', 'extra_spicy'];
const COOKING_SKILLS = ['beginner', 'intermediate', 'advanced'];
const DIETARY_OPTIONS = [
  'vegetarian', 'vegan', 'eggetarian', 'non-veg',
  'jain', 'gluten-free', 'lactose-free', 'keto', 'low-carb',
];
const CUISINE_OPTIONS = [
  'North Indian', 'South Indian', 'Bengali', 'Gujarati',
  'Punjabi', 'Rajasthani', 'Maharashtrian', 'Kerala',
  'Chinese', 'Italian', 'Continental', 'Thai',
];
const MEMORY_CATEGORIES = [
  { value: 'preference', label: 'Preference', icon: 'heart' },
  { value: 'health', label: 'Health', icon: 'medical-bag' },
  { value: 'family', label: 'Family', icon: 'account-group' },
  { value: 'general', label: 'General', icon: 'information' },
];

const SPICE_EMOJI: Record<string, string> = { mild: '🌶', medium: '🌶🌶', spicy: '🌶🌶🌶', extra_spicy: '🔥' };

export function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const { user, signOut } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('preferences');

  const [householdSize, setHouseholdSize] = useState(2);
  const [allergies, setAllergies] = useState<string[]>([]);
  const [dislikes, setDislikes] = useState<string[]>([]);
  const [dietaryTags, setDietaryTags] = useState<string[]>([]);
  const [favCuisines, setFavCuisines] = useState<string[]>([]);
  const [spiceLevel, setSpiceLevel] = useState('medium');
  const [cookingSkill, setCookingSkill] = useState('intermediate');

  const [newAllergy, setNewAllergy] = useState('');
  const [newDislike, setNewDislike] = useState('');

  const [memoryContent, setMemoryContent] = useState('');
  const [memoryCategory, setMemoryCategory] = useState('general');
  const [addingMemory, setAddingMemory] = useState(false);

  const loadProfile = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.fetchProfile();
      setProfile(data);
      setHouseholdSize(data.household_size || 2);
      setAllergies(data.allergies || []);
      setDislikes(data.dislikes || []);
      setDietaryTags(data.dietary_tags || []);
      setFavCuisines(data.fav_cuisines || []);
      setSpiceLevel(data.spice_level || 'medium');
      setCookingSkill(data.cooking_skill || 'intermediate');
    } catch (e) {
      console.error('Failed to load profile:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  const handleSave = async () => {
    try {
      setSaving(true);
      await api.updateProfile({
        household_size: householdSize,
        allergies, dislikes,
        dietary_tags: dietaryTags,
        fav_cuisines: favCuisines,
        spice_level: spiceLevel,
        cooking_skill: cookingSkill,
      });
      const msg = 'Profile saved! Meal suggestions will reflect these preferences.';
      Platform.OS === 'web' ? alert(msg) : Alert.alert('Saved', msg);
    } catch {
      const msg = 'Failed to save profile';
      Platform.OS === 'web' ? alert(msg) : Alert.alert('Error', msg);
    } finally {
      setSaving(false);
    }
  };

  const handleAddMemory = async () => {
    if (!memoryContent.trim()) return;
    try {
      setAddingMemory(true);
      const newMem = await api.addMemory(memoryCategory, memoryContent.trim());
      setProfile(prev => prev ? { ...prev, memories: [newMem, ...prev.memories] } : prev);
      setMemoryContent('');
    } catch {
      const msg = 'Failed to add memory';
      Platform.OS === 'web' ? alert(msg) : Alert.alert('Error', msg);
    } finally {
      setAddingMemory(false);
    }
  };

  const handleDeleteMemory = async (memoryId: string) => {
    const doDelete = async () => {
      try {
        await api.deleteMemory(memoryId);
        setProfile(prev => prev ? { ...prev, memories: prev.memories.filter(m => m.id !== memoryId) } : prev);
      } catch {
        const msg = 'Failed to delete memory';
        Platform.OS === 'web' ? alert(msg) : Alert.alert('Error', msg);
      }
    };
    if (Platform.OS === 'web') {
      if (window.confirm('Delete this memory?')) doDelete();
    } else {
      Alert.alert('Delete Memory', 'Are you sure?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: doDelete },
      ]);
    }
  };

  const toggleChip = (value: string, list: string[], setList: (v: string[]) => void) => {
    setList(list.includes(value) ? list.filter(v => v !== value) : [...list, value]);
  };

  const addCustomItem = (text: string, list: string[], setList: (v: string[]) => void, clear: () => void) => {
    const trimmed = text.trim();
    if (trimmed && !list.includes(trimmed)) setList([...list, trimmed]);
    clear();
  };

  const handleSignOut = () => {
    if (Platform.OS === 'web') {
      if (window.confirm('Sign out?')) signOut();
    } else {
      Alert.alert('Sign Out', 'Are you sure?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign Out', style: 'destructive', onPress: signOut },
      ]);
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#4CAF50" />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.scrollContent, { paddingBottom: layout.tabBarHeight + insets.bottom + 24 }]}
      showsVerticalScrollIndicator={false}
    >
      {/* Profile Header */}
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <View style={styles.avatarWrap}>
          {user?.picture_url ? (
            <Image source={{ uri: user.picture_url }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarFallback]}>
              <Text style={styles.avatarText}>{user?.name?.[0] || '?'}</Text>
            </View>
          )}
        </View>
        <Text variant="titleLarge" style={styles.userName}>{user?.name}</Text>
        <Text variant="bodyMedium" style={styles.userEmail}>{user?.email}</Text>
        <View style={styles.statRow}>
          <Surface style={styles.statPill} elevation={0}>
            <Text style={styles.statNum}>{profile?.inventory_count || 0}</Text>
            <Text style={styles.statLabel}>Items</Text>
          </Surface>
          <Surface style={styles.statPill} elevation={0}>
            <Text style={[styles.statNum, { color: '#FF9800' }]}>{profile?.expiring_count || 0}</Text>
            <Text style={styles.statLabel}>Expiring</Text>
          </Surface>
          <Surface style={styles.statPill} elevation={0}>
            <Text style={[styles.statNum, { color: '#9C27B0' }]}>{profile?.memories?.length || 0}</Text>
            <Text style={styles.statLabel}>Memories</Text>
          </Surface>
        </View>
      </View>

      {/* Tabs */}
      <SegmentedButtons
        value={activeTab}
        onValueChange={setActiveTab}
        buttons={[
          { value: 'preferences', label: 'Preferences' },
          { value: 'memory', label: 'Memory' },
          { value: 'settings', label: 'Settings' },
        ]}
        style={styles.tabs}
      />

      {/* ── PREFERENCES ─────────────────────────────────── */}
      {activeTab === 'preferences' && (
        <View style={styles.tabContent}>
          {/* Household */}
          <Surface style={styles.section} elevation={1}>
            <Text variant="titleSmall" style={styles.secTitle}>Household Size</Text>
            <View style={styles.counterRow}>
              <Pressable onPress={() => setHouseholdSize(Math.max(1, householdSize - 1))} style={styles.counterBtn}>
                <IconButton icon="minus" size={18} iconColor="#666" style={{ margin: 0 }} />
              </Pressable>
              <Text variant="headlineMedium" style={styles.counterVal}>{householdSize}</Text>
              <Pressable onPress={() => setHouseholdSize(householdSize + 1)} style={styles.counterBtn}>
                <IconButton icon="plus" size={18} iconColor="#666" style={{ margin: 0 }} />
              </Pressable>
            </View>
          </Surface>

          {/* Spice */}
          <Surface style={styles.section} elevation={1}>
            <Text variant="titleSmall" style={styles.secTitle}>Spice Level</Text>
            <View style={styles.chipRow}>
              {SPICE_LEVELS.map(level => (
                <Pressable key={level} onPress={() => setSpiceLevel(level)}>
                  <Surface style={[styles.optionPill, spiceLevel === level && styles.optionActive]} elevation={0}>
                    <Text style={styles.optionEmoji}>{SPICE_EMOJI[level]}</Text>
                    <Text style={[styles.optionText, spiceLevel === level && styles.optionTextActive]}>
                      {level === 'extra_spicy' ? 'Extra Spicy' : level.charAt(0).toUpperCase() + level.slice(1)}
                    </Text>
                  </Surface>
                </Pressable>
              ))}
            </View>
          </Surface>

          {/* Cooking Skill */}
          <Surface style={styles.section} elevation={1}>
            <Text variant="titleSmall" style={styles.secTitle}>Cooking Skill</Text>
            <View style={styles.chipRow}>
              {COOKING_SKILLS.map(skill => (
                <Pressable key={skill} onPress={() => setCookingSkill(skill)}>
                  <Surface style={[styles.optionPill, cookingSkill === skill && styles.optionActive]} elevation={0}>
                    <Text style={[styles.optionText, cookingSkill === skill && styles.optionTextActive]}>
                      {skill.charAt(0).toUpperCase() + skill.slice(1)}
                    </Text>
                  </Surface>
                </Pressable>
              ))}
            </View>
          </Surface>

          {/* Dietary */}
          <Surface style={styles.section} elevation={1}>
            <Text variant="titleSmall" style={styles.secTitle}>Dietary Preferences</Text>
            <View style={styles.chipRow}>
              {DIETARY_OPTIONS.map(tag => (
                <Chip
                  key={tag}
                  selected={dietaryTags.includes(tag)}
                  onPress={() => toggleChip(tag, dietaryTags, setDietaryTags)}
                  style={[styles.selChip, dietaryTags.includes(tag) && styles.selChipActive]}
                  textStyle={dietaryTags.includes(tag) ? styles.selChipTextActive : styles.selChipText}
                  showSelectedCheck={false}
                >
                  {tag}
                </Chip>
              ))}
            </View>
          </Surface>

          {/* Cuisines */}
          <Surface style={styles.section} elevation={1}>
            <Text variant="titleSmall" style={styles.secTitle}>Favorite Cuisines</Text>
            <View style={styles.chipRow}>
              {CUISINE_OPTIONS.map(cuisine => (
                <Chip
                  key={cuisine}
                  selected={favCuisines.includes(cuisine)}
                  onPress={() => toggleChip(cuisine, favCuisines, setFavCuisines)}
                  style={[styles.selChip, favCuisines.includes(cuisine) && styles.selChipActive]}
                  textStyle={favCuisines.includes(cuisine) ? styles.selChipTextActive : styles.selChipText}
                  showSelectedCheck={false}
                >
                  {cuisine}
                </Chip>
              ))}
            </View>
          </Surface>

          {/* Allergies */}
          <Surface style={styles.section} elevation={1}>
            <Text variant="titleSmall" style={styles.secTitle}>Allergies</Text>
            <View style={styles.chipRow}>
              {allergies.map(a => (
                <Chip key={a} onClose={() => setAllergies(allergies.filter(x => x !== a))} style={styles.dangerChip} textStyle={{ color: '#C62828' }}>
                  {a}
                </Chip>
              ))}
            </View>
            <View style={styles.addRow}>
              <TextInput
                dense mode="outlined" placeholder="Add allergy (e.g. peanuts)"
                value={newAllergy} onChangeText={setNewAllergy} style={styles.addInput}
                outlineColor="#E0E0E0" outlineStyle={{ borderRadius: 12 }}
                onSubmitEditing={() => addCustomItem(newAllergy, allergies, setAllergies, () => setNewAllergy(''))}
              />
              <IconButton icon="plus-circle" iconColor="#F44336" size={28} onPress={() => addCustomItem(newAllergy, allergies, setAllergies, () => setNewAllergy(''))} style={{ margin: 0 }} />
            </View>
          </Surface>

          {/* Dislikes */}
          <Surface style={styles.section} elevation={1}>
            <Text variant="titleSmall" style={styles.secTitle}>Dislikes</Text>
            <View style={styles.chipRow}>
              {dislikes.map(d => (
                <Chip key={d} onClose={() => setDislikes(dislikes.filter(x => x !== d))} style={styles.grayChip}>
                  {d}
                </Chip>
              ))}
            </View>
            <View style={styles.addRow}>
              <TextInput
                dense mode="outlined" placeholder="Add dislike (e.g. bitter gourd)"
                value={newDislike} onChangeText={setNewDislike} style={styles.addInput}
                outlineColor="#E0E0E0" outlineStyle={{ borderRadius: 12 }}
                onSubmitEditing={() => addCustomItem(newDislike, dislikes, setDislikes, () => setNewDislike(''))}
              />
              <IconButton icon="plus-circle" iconColor="#888" size={28} onPress={() => addCustomItem(newDislike, dislikes, setDislikes, () => setNewDislike(''))} style={{ margin: 0 }} />
            </View>
          </Surface>

          <Button mode="contained" onPress={handleSave} loading={saving} style={styles.saveBtn} contentStyle={{ paddingVertical: 4 }}>
            Save Preferences
          </Button>
        </View>
      )}

      {/* ── MEMORY ───────────────────────────────────────── */}
      {activeTab === 'memory' && (
        <View style={styles.tabContent}>
          <Surface style={styles.section} elevation={1}>
            <Text variant="titleSmall" style={styles.secTitle}>Add a Memory</Text>
            <Text variant="bodySmall" style={styles.hint}>
              Tell us things like "My kid doesn't eat spicy food", "We love Sunday biryani". These notes personalize meal suggestions.
            </Text>
            <View style={styles.chipRow}>
              {MEMORY_CATEGORIES.map(cat => (
                <Pressable key={cat.value} onPress={() => setMemoryCategory(cat.value)}>
                  <Surface style={[styles.optionPill, memoryCategory === cat.value && styles.optionActive]} elevation={0}>
                    <IconButton icon={cat.icon} size={14} iconColor={memoryCategory === cat.value ? '#fff' : '#888'} style={{ margin: 0 }} />
                    <Text style={[styles.optionText, memoryCategory === cat.value && styles.optionTextActive]}>{cat.label}</Text>
                  </Surface>
                </Pressable>
              ))}
            </View>
            <TextInput
              mode="outlined" placeholder="e.g. My daughter is allergic to cashews"
              value={memoryContent} onChangeText={setMemoryContent}
              multiline numberOfLines={3} style={styles.memInput}
              outlineColor="#E0E0E0" activeOutlineColor="#4CAF50" outlineStyle={{ borderRadius: 12 }}
            />
            <Button mode="contained" onPress={handleAddMemory} loading={addingMemory} disabled={!memoryContent.trim()} style={styles.addMemBtn}>
              Add Memory
            </Button>
          </Surface>

          <Text variant="titleSmall" style={styles.memListTitle}>Your Memories ({profile?.memories?.length || 0})</Text>

          {(!profile?.memories || profile.memories.length === 0) ? (
            <Surface style={styles.emptyMem} elevation={1}>
              <IconButton icon="brain" iconColor="#ccc" size={40} style={{ margin: 0 }} />
              <Text variant="bodyMedium" style={styles.emptyMemText}>
                No memories yet. Add notes about your family's food habits to get better suggestions.
              </Text>
            </Surface>
          ) : (
            profile.memories.map((memory: UserMemory) => (
              <Surface key={memory.id} style={styles.memCard} elevation={1}>
                <View style={styles.memHeader}>
                  <Chip compact style={styles.memCatChip} textStyle={{ fontSize: 11 }}>{memory.category}</Chip>
                  <IconButton icon="close" size={16} iconColor="#ccc" onPress={() => handleDeleteMemory(memory.id)} style={{ margin: 0 }} />
                </View>
                <Text variant="bodyMedium" style={styles.memText}>{memory.content}</Text>
                <Text variant="bodySmall" style={styles.memDate}>{new Date(memory.created_at).toLocaleDateString()}</Text>
              </Surface>
            ))
          )}
        </View>
      )}

      {/* ── SETTINGS ─────────────────────────────────────── */}
      {activeTab === 'settings' && (
        <View style={styles.tabContent}>
          <Surface style={styles.section} elevation={1}>
            <Text variant="titleSmall" style={styles.secTitle}>Account</Text>
            <View style={styles.settRow}>
              <Text variant="bodyMedium" style={styles.settLabel}>Name</Text>
              <Text variant="bodyMedium" style={styles.settVal}>{user?.name}</Text>
            </View>
            <Divider style={styles.settDivider} />
            <View style={styles.settRow}>
              <Text variant="bodyMedium" style={styles.settLabel}>Email</Text>
              <Text variant="bodyMedium" style={styles.settVal}>{user?.email}</Text>
            </View>
            <Divider style={styles.settDivider} />
            <View style={styles.settRow}>
              <Text variant="bodyMedium" style={styles.settLabel}>Provider</Text>
              <Chip compact icon="google" style={{ backgroundColor: '#E3F2FD' }} textStyle={{ fontSize: 12 }}>Google</Chip>
            </View>
          </Surface>

          <Surface style={styles.section} elevation={1}>
            <Text variant="titleSmall" style={styles.secTitle}>About</Text>
            <View style={styles.settRow}>
              <Text variant="bodyMedium" style={styles.settLabel}>App Version</Text>
              <Text variant="bodyMedium" style={styles.settVal}>1.0.0</Text>
            </View>
          </Surface>

          <Button mode="contained" onPress={handleSignOut} style={styles.signOutBtn} buttonColor="#F44336" contentStyle={{ paddingVertical: 4 }}>
            Sign Out
          </Button>
        </View>
      )}

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F9FA' },
  scrollContent: { paddingBottom: 24 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  header: {
    backgroundColor: '#607D8B',
    alignItems: 'center',
    paddingTop: 16,
    paddingBottom: 24,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
  },
  avatarWrap: { marginBottom: 12 },
  avatar: { width: 80, height: 80, borderRadius: 40, borderWidth: 3, borderColor: 'rgba(255,255,255,0.3)' },
  avatarFallback: { backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center' },
  avatarText: { fontSize: 32, color: '#fff', fontWeight: '700' },
  userName: { color: '#fff', fontWeight: '800' },
  userEmail: { color: 'rgba(255,255,255,0.8)', marginTop: 2 },
  statRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  statPill: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 14,
    alignItems: 'center',
  },
  statNum: { color: '#fff', fontWeight: '800', fontSize: 18 },
  statLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 10, marginTop: 2 },

  tabs: { marginHorizontal: 20, marginTop: 16, marginBottom: 4 },
  tabContent: { paddingHorizontal: 20, paddingTop: 8 },

  section: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  secTitle: { fontWeight: '700', color: '#333', marginBottom: 12 },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },

  optionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F5F5F5',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
  },
  optionActive: { backgroundColor: '#4CAF50' },
  optionEmoji: { fontSize: 14 },
  optionText: { fontSize: 13, color: '#666', fontWeight: '600' },
  optionTextActive: { color: '#fff' },

  selChip: { backgroundColor: '#F5F5F5' },
  selChipActive: { backgroundColor: '#4CAF50' },
  selChipText: { color: '#666' },
  selChipTextActive: { color: '#fff' },

  counterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 20 },
  counterBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#F5F5F5', justifyContent: 'center', alignItems: 'center' },
  counterVal: { fontWeight: '800', minWidth: 40, textAlign: 'center', color: '#333' },

  addRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  addInput: { flex: 1, marginRight: 4, backgroundColor: '#fff' },

  dangerChip: { backgroundColor: '#FFEBEE' },
  grayChip: { backgroundColor: '#F5F5F5' },

  saveBtn: { borderRadius: 14, marginTop: 4, marginBottom: 16, backgroundColor: '#4CAF50' },

  hint: { color: '#888', marginBottom: 12, lineHeight: 18 },
  memInput: { marginTop: 8, marginBottom: 12, backgroundColor: '#fff' },
  addMemBtn: { backgroundColor: '#4CAF50', borderRadius: 12 },
  memListTitle: { fontWeight: '700', color: '#555', marginTop: 12, marginBottom: 10 },
  emptyMem: { borderRadius: 18, backgroundColor: '#fff', padding: 28, alignItems: 'center' },
  emptyMemText: { textAlign: 'center', color: '#888', marginTop: 8, lineHeight: 20 },
  memCard: { backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 8 },
  memHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  memCatChip: { backgroundColor: '#E8F5E9' },
  memText: { color: '#333', lineHeight: 20 },
  memDate: { color: '#bbb', marginTop: 6 },

  settRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12 },
  settLabel: { color: '#888' },
  settVal: { color: '#555', fontWeight: '500' },
  settDivider: { marginVertical: 2 },
  signOutBtn: { borderRadius: 14, marginTop: 8 },
});
