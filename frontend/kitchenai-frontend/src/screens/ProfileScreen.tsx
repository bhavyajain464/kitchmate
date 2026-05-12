import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  Alert,
  Platform,
  Image,
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
import { useAuth } from '../context/AuthContext';
import { UserProfile, UserMemory } from '../types';
import * as api from '../services/api';

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
  { value: 'preference', label: 'Preference' },
  { value: 'health', label: 'Health' },
  { value: 'family', label: 'Family' },
  { value: 'general', label: 'General' },
];

export function ProfileScreen() {
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

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const handleSave = async () => {
    try {
      setSaving(true);
      await api.updateProfile({
        household_size: householdSize,
        allergies,
        dislikes,
        dietary_tags: dietaryTags,
        fav_cuisines: favCuisines,
        spice_level: spiceLevel,
        cooking_skill: cookingSkill,
      });
      const msg = 'Profile saved! Your meal suggestions will now reflect these preferences.';
      Platform.OS === 'web' ? alert(msg) : Alert.alert('Saved', msg);
    } catch (e) {
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
      setProfile(prev => prev ? {
        ...prev,
        memories: [newMem, ...prev.memories],
      } : prev);
      setMemoryContent('');
    } catch (e) {
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
        setProfile(prev => prev ? {
          ...prev,
          memories: prev.memories.filter(m => m.id !== memoryId),
        } : prev);
      } catch (e) {
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
    if (trimmed && !list.includes(trimmed)) {
      setList([...list, trimmed]);
    }
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
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* User Info Card */}
      <Card style={styles.userCard}>
        <Card.Content style={styles.userContent}>
          {user?.picture_url ? (
            <Image source={{ uri: user.picture_url }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarPlaceholder]}>
              <Text style={styles.avatarText}>{user?.name?.[0] || '?'}</Text>
            </View>
          )}
          <View style={styles.userInfo}>
            <Text variant="titleLarge" style={styles.userName}>{user?.name}</Text>
            <Text variant="bodyMedium" style={styles.userEmail}>{user?.email}</Text>
            <View style={styles.statsRow}>
              <Surface style={styles.statBadge} elevation={1}>
                <Text style={styles.statNumber}>{profile?.inventory_count || 0}</Text>
                <Text style={styles.statLabel}>Items</Text>
              </Surface>
              <Surface style={styles.statBadge} elevation={1}>
                <Text style={[styles.statNumber, { color: '#FF9800' }]}>{profile?.expiring_count || 0}</Text>
                <Text style={styles.statLabel}>Expiring</Text>
              </Surface>
              <Surface style={styles.statBadge} elevation={1}>
                <Text style={styles.statNumber}>{profile?.memories?.length || 0}</Text>
                <Text style={styles.statLabel}>Memories</Text>
              </Surface>
            </View>
          </View>
        </Card.Content>
      </Card>

      {/* Tab Selector */}
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

      {activeTab === 'preferences' && (
        <View>
          {/* Household Size */}
          <Card style={styles.card}>
            <Card.Content>
              <Text variant="titleMedium" style={styles.sectionTitle}>Household Size</Text>
              <View style={styles.counterRow}>
                <IconButton icon="minus" mode="contained" onPress={() => setHouseholdSize(Math.max(1, householdSize - 1))} />
                <Text variant="headlineMedium" style={styles.counterValue}>{householdSize}</Text>
                <IconButton icon="plus" mode="contained" onPress={() => setHouseholdSize(householdSize + 1)} />
              </View>
            </Card.Content>
          </Card>

          {/* Spice Level */}
          <Card style={styles.card}>
            <Card.Content>
              <Text variant="titleMedium" style={styles.sectionTitle}>Spice Level</Text>
              <View style={styles.chipRow}>
                {SPICE_LEVELS.map(level => (
                  <Chip
                    key={level}
                    selected={spiceLevel === level}
                    onPress={() => setSpiceLevel(level)}
                    style={[styles.chip, spiceLevel === level && styles.chipSelected]}
                    textStyle={spiceLevel === level ? styles.chipTextSelected : undefined}
                  >
                    {level === 'extra_spicy' ? 'Extra Spicy' : level.charAt(0).toUpperCase() + level.slice(1)}
                  </Chip>
                ))}
              </View>
            </Card.Content>
          </Card>

          {/* Cooking Skill */}
          <Card style={styles.card}>
            <Card.Content>
              <Text variant="titleMedium" style={styles.sectionTitle}>Cooking Skill</Text>
              <View style={styles.chipRow}>
                {COOKING_SKILLS.map(skill => (
                  <Chip
                    key={skill}
                    selected={cookingSkill === skill}
                    onPress={() => setCookingSkill(skill)}
                    style={[styles.chip, cookingSkill === skill && styles.chipSelected]}
                    textStyle={cookingSkill === skill ? styles.chipTextSelected : undefined}
                  >
                    {skill.charAt(0).toUpperCase() + skill.slice(1)}
                  </Chip>
                ))}
              </View>
            </Card.Content>
          </Card>

          {/* Dietary Preferences */}
          <Card style={styles.card}>
            <Card.Content>
              <Text variant="titleMedium" style={styles.sectionTitle}>Dietary Preferences</Text>
              <View style={styles.chipRow}>
                {DIETARY_OPTIONS.map(tag => (
                  <Chip
                    key={tag}
                    selected={dietaryTags.includes(tag)}
                    onPress={() => toggleChip(tag, dietaryTags, setDietaryTags)}
                    style={[styles.chip, dietaryTags.includes(tag) && styles.chipSelected]}
                    textStyle={dietaryTags.includes(tag) ? styles.chipTextSelected : undefined}
                  >
                    {tag}
                  </Chip>
                ))}
              </View>
            </Card.Content>
          </Card>

          {/* Favorite Cuisines */}
          <Card style={styles.card}>
            <Card.Content>
              <Text variant="titleMedium" style={styles.sectionTitle}>Favorite Cuisines</Text>
              <View style={styles.chipRow}>
                {CUISINE_OPTIONS.map(cuisine => (
                  <Chip
                    key={cuisine}
                    selected={favCuisines.includes(cuisine)}
                    onPress={() => toggleChip(cuisine, favCuisines, setFavCuisines)}
                    style={[styles.chip, favCuisines.includes(cuisine) && styles.chipSelected]}
                    textStyle={favCuisines.includes(cuisine) ? styles.chipTextSelected : undefined}
                  >
                    {cuisine}
                  </Chip>
                ))}
              </View>
            </Card.Content>
          </Card>

          {/* Allergies */}
          <Card style={styles.card}>
            <Card.Content>
              <Text variant="titleMedium" style={styles.sectionTitle}>Allergies</Text>
              <View style={styles.chipRow}>
                {allergies.map(a => (
                  <Chip
                    key={a}
                    onClose={() => setAllergies(allergies.filter(x => x !== a))}
                    style={[styles.chip, { backgroundColor: '#FFCDD2' }]}
                  >
                    {a}
                  </Chip>
                ))}
              </View>
              <View style={styles.addRow}>
                <TextInput
                  dense
                  mode="outlined"
                  placeholder="Add allergy (e.g. peanuts)"
                  value={newAllergy}
                  onChangeText={setNewAllergy}
                  style={styles.addInput}
                  onSubmitEditing={() => addCustomItem(newAllergy, allergies, setAllergies, () => setNewAllergy(''))}
                />
                <IconButton
                  icon="plus"
                  mode="contained"
                  onPress={() => addCustomItem(newAllergy, allergies, setAllergies, () => setNewAllergy(''))}
                />
              </View>
            </Card.Content>
          </Card>

          {/* Dislikes */}
          <Card style={styles.card}>
            <Card.Content>
              <Text variant="titleMedium" style={styles.sectionTitle}>Dislikes</Text>
              <View style={styles.chipRow}>
                {dislikes.map(d => (
                  <Chip
                    key={d}
                    onClose={() => setDislikes(dislikes.filter(x => x !== d))}
                    style={styles.chip}
                  >
                    {d}
                  </Chip>
                ))}
              </View>
              <View style={styles.addRow}>
                <TextInput
                  dense
                  mode="outlined"
                  placeholder="Add dislike (e.g. bitter gourd)"
                  value={newDislike}
                  onChangeText={setNewDislike}
                  style={styles.addInput}
                  onSubmitEditing={() => addCustomItem(newDislike, dislikes, setDislikes, () => setNewDislike(''))}
                />
                <IconButton
                  icon="plus"
                  mode="contained"
                  onPress={() => addCustomItem(newDislike, dislikes, setDislikes, () => setNewDislike(''))}
                />
              </View>
            </Card.Content>
          </Card>

          <Button
            mode="contained"
            onPress={handleSave}
            loading={saving}
            style={styles.saveButton}
            labelStyle={styles.saveButtonLabel}
          >
            Save Preferences
          </Button>
        </View>
      )}

      {activeTab === 'memory' && (
        <View>
          <Card style={styles.card}>
            <Card.Content>
              <Text variant="titleMedium" style={styles.sectionTitle}>Add a Memory</Text>
              <Text variant="bodySmall" style={styles.hint}>
                Tell us things like "My kid doesn't eat spicy food", "We love Sunday biryani",
                "Husband is diabetic", etc. These notes help personalize your meal suggestions.
              </Text>

              <View style={styles.chipRow}>
                {MEMORY_CATEGORIES.map(cat => (
                  <Chip
                    key={cat.value}
                    selected={memoryCategory === cat.value}
                    onPress={() => setMemoryCategory(cat.value)}
                    style={[styles.chip, memoryCategory === cat.value && styles.chipSelected]}
                    textStyle={memoryCategory === cat.value ? styles.chipTextSelected : undefined}
                  >
                    {cat.label}
                  </Chip>
                ))}
              </View>

              <TextInput
                mode="outlined"
                placeholder="e.g. My daughter is allergic to cashews"
                value={memoryContent}
                onChangeText={setMemoryContent}
                multiline
                numberOfLines={3}
                style={styles.memoryInput}
              />
              <Button
                mode="contained"
                onPress={handleAddMemory}
                loading={addingMemory}
                disabled={!memoryContent.trim()}
                style={styles.addMemoryButton}
              >
                Add Memory
              </Button>
            </Card.Content>
          </Card>

          <Text variant="titleMedium" style={styles.memoriesTitle}>
            Your Memories ({profile?.memories?.length || 0})
          </Text>

          {(!profile?.memories || profile.memories.length === 0) ? (
            <Card style={styles.card}>
              <Card.Content style={styles.emptyState}>
                <Text style={styles.emptyEmoji}>🧠</Text>
                <Text variant="bodyMedium" style={styles.emptyText}>
                  No memories yet. Add notes about your family's preferences,
                  health conditions, or food habits to get better meal suggestions.
                </Text>
              </Card.Content>
            </Card>
          ) : (
            profile.memories.map((memory: UserMemory) => (
              <Card key={memory.id} style={styles.memoryCard}>
                <Card.Content style={styles.memoryContent}>
                  <View style={styles.memoryHeader}>
                    <Chip compact style={styles.memoryCategoryChip}>
                      {memory.category}
                    </Chip>
                    <IconButton
                      icon="delete-outline"
                      size={18}
                      onPress={() => handleDeleteMemory(memory.id)}
                    />
                  </View>
                  <Text variant="bodyMedium" style={styles.memoryText}>{memory.content}</Text>
                  <Text variant="bodySmall" style={styles.memoryDate}>
                    {new Date(memory.created_at).toLocaleDateString()}
                  </Text>
                </Card.Content>
              </Card>
            ))
          )}
        </View>
      )}

      {activeTab === 'settings' && (
        <View>
          <Card style={styles.card}>
            <Card.Content>
              <Text variant="titleMedium" style={styles.sectionTitle}>Account</Text>
              <Divider style={styles.divider} />
              <View style={styles.settingRow}>
                <Text variant="bodyMedium">Name</Text>
                <Text variant="bodyMedium" style={styles.settingValue}>{user?.name}</Text>
              </View>
              <Divider style={styles.divider} />
              <View style={styles.settingRow}>
                <Text variant="bodyMedium">Email</Text>
                <Text variant="bodyMedium" style={styles.settingValue}>{user?.email}</Text>
              </View>
              <Divider style={styles.divider} />
              <View style={styles.settingRow}>
                <Text variant="bodyMedium">Provider</Text>
                <Text variant="bodyMedium" style={styles.settingValue}>Google</Text>
              </View>
            </Card.Content>
          </Card>

          <Card style={styles.card}>
            <Card.Content>
              <Text variant="titleMedium" style={styles.sectionTitle}>About</Text>
              <Divider style={styles.divider} />
              <View style={styles.settingRow}>
                <Text variant="bodyMedium">App Version</Text>
                <Text variant="bodyMedium" style={styles.settingValue}>1.0.0</Text>
              </View>
              <Divider style={styles.divider} />
              <View style={styles.settingRow}>
                <Text variant="bodyMedium">Powered by</Text>
                <Text variant="bodyMedium" style={styles.settingValue}>Google Gemini AI</Text>
              </View>
            </Card.Content>
          </Card>

          <Button
            mode="contained"
            onPress={handleSignOut}
            style={styles.signOutButton}
            labelStyle={styles.signOutLabel}
            buttonColor="#F44336"
          >
            Sign Out
          </Button>
        </View>
      )}

      <View style={styles.bottomSpacer} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F5' },
  content: { padding: 16 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  userCard: { marginBottom: 16, borderRadius: 16, backgroundColor: '#fff' },
  userContent: { flexDirection: 'row', alignItems: 'center', padding: 8 },
  avatar: { width: 72, height: 72, borderRadius: 36, marginRight: 16 },
  avatarPlaceholder: { backgroundColor: '#4CAF50', justifyContent: 'center', alignItems: 'center' },
  avatarText: { fontSize: 28, color: '#fff', fontWeight: 'bold' },
  userInfo: { flex: 1 },
  userName: { fontWeight: 'bold', color: '#333' },
  userEmail: { color: '#777', marginBottom: 8 },
  statsRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  statBadge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, alignItems: 'center', backgroundColor: '#F5F5F5' },
  statNumber: { fontSize: 18, fontWeight: 'bold', color: '#4CAF50' },
  statLabel: { fontSize: 10, color: '#999' },
  tabs: { marginBottom: 16 },
  card: { marginBottom: 12, borderRadius: 12, backgroundColor: '#fff' },
  sectionTitle: { fontWeight: 'bold', marginBottom: 12, color: '#333' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  chip: { marginBottom: 4 },
  chipSelected: { backgroundColor: '#4CAF50' },
  chipTextSelected: { color: '#fff' },
  counterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16 },
  counterValue: { minWidth: 40, textAlign: 'center', fontWeight: 'bold' },
  addRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  addInput: { flex: 1, marginRight: 8 },
  saveButton: { marginTop: 8, marginBottom: 16, borderRadius: 12, backgroundColor: '#4CAF50', paddingVertical: 4 },
  saveButtonLabel: { fontSize: 16 },
  hint: { color: '#888', marginBottom: 12, lineHeight: 18 },
  memoryInput: { marginTop: 8, marginBottom: 12 },
  addMemoryButton: { backgroundColor: '#4CAF50', borderRadius: 10 },
  memoriesTitle: { fontWeight: 'bold', marginVertical: 12, marginLeft: 4, color: '#333' },
  memoryCard: { marginBottom: 8, borderRadius: 12, backgroundColor: '#fff' },
  memoryContent: { paddingVertical: 8 },
  memoryHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  memoryCategoryChip: { backgroundColor: '#E8F5E9' },
  memoryText: { marginTop: 4, color: '#333', lineHeight: 20 },
  memoryDate: { marginTop: 6, color: '#aaa' },
  emptyState: { alignItems: 'center', padding: 24 },
  emptyEmoji: { fontSize: 48, marginBottom: 12 },
  emptyText: { textAlign: 'center', color: '#888', lineHeight: 20 },
  settingRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12 },
  settingValue: { color: '#666' },
  divider: { marginVertical: 2 },
  signOutButton: { marginTop: 16, borderRadius: 12, paddingVertical: 4 },
  signOutLabel: { fontSize: 16, color: '#fff' },
  bottomSpacer: { height: 40 },
});
