import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  ScrollView,
  Pressable,
  Alert,
  Platform,
  Image,
} from 'react-native';
import {
  Text,
  Surface,
  Button,
  Chip,
  IconButton,
  TextInput,
  Checkbox,
  ActivityIndicator,
} from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as api from '../services/api';

const logo = require('../../assets/icon.png');

const STEPS = ['Welcome', 'Preferences', 'Kitchen Staples'];

const DIETARY_OPTIONS = [
  'vegetarian', 'vegan', 'eggetarian', 'non-veg',
  'jain', 'gluten-free', 'lactose-free', 'keto',
];
const CUISINE_OPTIONS = [
  'North Indian', 'South Indian', 'Bengali', 'Gujarati',
  'Punjabi', 'Chinese', 'Italian', 'Continental', 'Thai',
];
const SPICE_LEVELS = [
  { id: 'mild', label: 'Mild', emoji: '🌶' },
  { id: 'medium', label: 'Medium', emoji: '🌶🌶' },
  { id: 'spicy', label: 'Spicy', emoji: '🌶🌶🌶' },
  { id: 'extra_spicy', label: 'Extra Spicy', emoji: '🔥' },
];

interface StapleItem {
  name: string;
  qty: number;
  unit: string;
  category: string;
  selected: boolean;
}

const DEFAULT_STAPLES: StapleItem[] = [
  // Grains & Flours
  { name: 'Wheat Flour (Atta)', qty: 5, unit: 'kg', category: 'Grains & Flours', selected: true },
  { name: 'Rice (Basmati)', qty: 5, unit: 'kg', category: 'Grains & Flours', selected: true },
  { name: 'Rice Flour', qty: 1, unit: 'kg', category: 'Grains & Flours', selected: false },
  { name: 'Besan (Gram Flour)', qty: 500, unit: 'g', category: 'Grains & Flours', selected: false },
  { name: 'Sooji (Semolina)', qty: 500, unit: 'g', category: 'Grains & Flours', selected: false },
  { name: 'Poha (Flattened Rice)', qty: 500, unit: 'g', category: 'Grains & Flours', selected: false },

  // Dals & Lentils
  { name: 'Toor Dal', qty: 1, unit: 'kg', category: 'Dals & Lentils', selected: true },
  { name: 'Moong Dal', qty: 500, unit: 'g', category: 'Dals & Lentils', selected: true },
  { name: 'Chana Dal', qty: 500, unit: 'g', category: 'Dals & Lentils', selected: false },
  { name: 'Masoor Dal', qty: 500, unit: 'g', category: 'Dals & Lentils', selected: false },
  { name: 'Rajma (Kidney Beans)', qty: 500, unit: 'g', category: 'Dals & Lentils', selected: false },
  { name: 'Chole (Chickpeas)', qty: 500, unit: 'g', category: 'Dals & Lentils', selected: false },

  // Spices
  { name: 'Turmeric Powder', qty: 200, unit: 'g', category: 'Spices', selected: true },
  { name: 'Red Chilli Powder', qty: 200, unit: 'g', category: 'Spices', selected: true },
  { name: 'Coriander Powder', qty: 200, unit: 'g', category: 'Spices', selected: true },
  { name: 'Cumin Powder', qty: 100, unit: 'g', category: 'Spices', selected: true },
  { name: 'Garam Masala', qty: 100, unit: 'g', category: 'Spices', selected: true },
  { name: 'Cumin Seeds (Jeera)', qty: 100, unit: 'g', category: 'Spices', selected: true },
  { name: 'Mustard Seeds', qty: 100, unit: 'g', category: 'Spices', selected: true },
  { name: 'Black Pepper', qty: 50, unit: 'g', category: 'Spices', selected: false },
  { name: 'Cinnamon Sticks', qty: 50, unit: 'g', category: 'Spices', selected: false },
  { name: 'Bay Leaves', qty: 1, unit: 'pack', category: 'Spices', selected: false },

  // Oils & Essentials
  { name: 'Cooking Oil', qty: 2, unit: 'L', category: 'Oils & Essentials', selected: true },
  { name: 'Ghee', qty: 500, unit: 'ml', category: 'Oils & Essentials', selected: true },
  { name: 'Salt', qty: 1, unit: 'kg', category: 'Oils & Essentials', selected: true },
  { name: 'Sugar', qty: 1, unit: 'kg', category: 'Oils & Essentials', selected: true },
  { name: 'Tea (Chai)', qty: 250, unit: 'g', category: 'Oils & Essentials', selected: true },
  { name: 'Coffee Powder', qty: 200, unit: 'g', category: 'Oils & Essentials', selected: false },

  // Dairy & Fresh
  { name: 'Milk', qty: 1, unit: 'L', category: 'Dairy & Fresh', selected: true },
  { name: 'Curd (Yogurt)', qty: 500, unit: 'g', category: 'Dairy & Fresh', selected: true },
  { name: 'Butter', qty: 200, unit: 'g', category: 'Dairy & Fresh', selected: false },
  { name: 'Paneer', qty: 200, unit: 'g', category: 'Dairy & Fresh', selected: false },

  // Vegetables (basics)
  { name: 'Onions', qty: 2, unit: 'kg', category: 'Vegetables', selected: true },
  { name: 'Tomatoes', qty: 1, unit: 'kg', category: 'Vegetables', selected: true },
  { name: 'Potatoes', qty: 2, unit: 'kg', category: 'Vegetables', selected: true },
  { name: 'Green Chillies', qty: 100, unit: 'g', category: 'Vegetables', selected: true },
  { name: 'Ginger', qty: 100, unit: 'g', category: 'Vegetables', selected: true },
  { name: 'Garlic', qty: 100, unit: 'g', category: 'Vegetables', selected: true },
  { name: 'Coriander Leaves', qty: 1, unit: 'bunch', category: 'Vegetables', selected: false },
  { name: 'Curry Leaves', qty: 1, unit: 'bunch', category: 'Vegetables', selected: false },
  { name: 'Lemons', qty: 4, unit: 'pcs', category: 'Vegetables', selected: false },
];

interface OnboardingScreenProps {
  onComplete: () => void;
}

export function OnboardingScreen({ onComplete }: OnboardingScreenProps) {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);

  // Preferences
  const [householdSize, setHouseholdSize] = useState(2);
  const [dietaryTags, setDietaryTags] = useState<string[]>([]);
  const [favCuisines, setFavCuisines] = useState<string[]>([]);
  const [spiceLevel, setSpiceLevel] = useState('medium');
  const [allergies, setAllergies] = useState<string[]>([]);
  const [newAllergy, setNewAllergy] = useState('');

  // Staples
  const [staples, setStaples] = useState<StapleItem[]>(DEFAULT_STAPLES);

  const toggleDietary = (tag: string) =>
    setDietaryTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]);
  const toggleCuisine = (c: string) =>
    setFavCuisines(prev => prev.includes(c) ? prev.filter(t => t !== c) : [...prev, c]);
  const toggleStaple = (idx: number) =>
    setStaples(prev => prev.map((s, i) => i === idx ? { ...s, selected: !s.selected } : s));

  const selectAllCategory = (cat: string, select: boolean) =>
    setStaples(prev => prev.map(s => s.category === cat ? { ...s, selected: select } : s));

  const addAllergy = () => {
    const trimmed = newAllergy.trim();
    if (trimmed && !allergies.includes(trimmed)) setAllergies(prev => [...prev, trimmed]);
    setNewAllergy('');
  };

  const handleComplete = async () => {
    setSaving(true);
    try {
      const selectedItems = staples.filter(s => s.selected).map(s => ({
        name: s.name, qty: s.qty, unit: s.unit,
      }));
      await api.completeOnboarding({
        household_size: householdSize,
        dietary_tags: dietaryTags,
        fav_cuisines: favCuisines,
        spice_level: spiceLevel,
        cooking_skill: 'intermediate',
        allergies,
        dislikes: [],
        items: selectedItems,
      });
      onComplete();
    } catch (e: any) {
      const msg = 'Failed to complete setup. Please try again.';
      Platform.OS === 'web' ? window.alert(msg) : Alert.alert('Error', msg);
    } finally {
      setSaving(false);
    }
  };

  const categories = [...new Set(staples.map(s => s.category))];
  const selectedCount = staples.filter(s => s.selected).length;

  return (
    <View style={styles.container}>
      {/* Progress */}
      <View style={[styles.progressWrap, { paddingTop: insets.top + 12 }]}>
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${((step + 1) / STEPS.length) * 100}%` }]} />
        </View>
        <Text style={styles.progressText}>Step {step + 1} of {STEPS.length}</Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >

        {/* ── Step 0: Welcome ────────────────────────── */}
        {step === 0 && (
          <View style={styles.stepWrap}>
            <Surface style={styles.welcomeCard} elevation={2}>
              <Image source={logo} style={styles.welcomeLogo} resizeMode="contain" />
              <Text variant="headlineMedium" style={styles.welcomeTitle}>Welcome to Kitchen AI</Text>
              <Text variant="bodyMedium" style={styles.welcomeDesc}>
                Let's set up your kitchen in 2 quick steps. We'll personalize your meal suggestions and stock your pantry with essentials.
              </Text>
            </Surface>

            <View style={styles.featureList}>
              {[
                { icon: 'account-cog', text: 'Set your food preferences' },
                { icon: 'basket', text: 'Add common kitchen staples' },
                { icon: 'robot', text: 'Get AI-powered meal ideas' },
              ].map((f, i) => (
                <View key={i} style={styles.featureRow}>
                  <Surface style={styles.featureIcon} elevation={0}>
                    <IconButton icon={f.icon} iconColor="#4CAF50" size={20} style={{ margin: 0 }} />
                  </Surface>
                  <Text variant="bodyMedium" style={styles.featureText}>{f.text}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* ── Step 1: Preferences ────────────────────── */}
        {step === 1 && (
          <View style={styles.stepWrap}>
            <Text variant="headlineSmall" style={styles.stepTitle}>Your Preferences</Text>
            <Text variant="bodyMedium" style={styles.stepSub}>This helps us suggest the right meals</Text>

            <Surface style={styles.section} elevation={1}>
              <Text variant="titleSmall" style={styles.secLabel}>Household Size</Text>
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

            <Surface style={styles.section} elevation={1}>
              <Text variant="titleSmall" style={styles.secLabel}>Dietary Preference</Text>
              <View style={styles.chipRow}>
                {DIETARY_OPTIONS.map(tag => (
                  <Chip
                    key={tag}
                    selected={dietaryTags.includes(tag)}
                    onPress={() => toggleDietary(tag)}
                    style={[styles.chip, dietaryTags.includes(tag) && styles.chipActive]}
                    textStyle={dietaryTags.includes(tag) ? { color: '#fff' } : { color: '#555' }}
                    showSelectedCheck={false}
                  >
                    {tag}
                  </Chip>
                ))}
              </View>
            </Surface>

            <Surface style={styles.section} elevation={1}>
              <Text variant="titleSmall" style={styles.secLabel}>Spice Level</Text>
              <View style={styles.chipRow}>
                {SPICE_LEVELS.map(s => (
                  <Pressable key={s.id} onPress={() => setSpiceLevel(s.id)}>
                    <Surface style={[styles.spicePill, spiceLevel === s.id && styles.spicePillActive]} elevation={0}>
                      <Text style={styles.spiceEmoji}>{s.emoji}</Text>
                      <Text style={[styles.spiceText, spiceLevel === s.id && { color: '#fff' }]}>{s.label}</Text>
                    </Surface>
                  </Pressable>
                ))}
              </View>
            </Surface>

            <Surface style={styles.section} elevation={1}>
              <Text variant="titleSmall" style={styles.secLabel}>Favorite Cuisines</Text>
              <View style={styles.chipRow}>
                {CUISINE_OPTIONS.map(c => (
                  <Chip
                    key={c}
                    selected={favCuisines.includes(c)}
                    onPress={() => toggleCuisine(c)}
                    style={[styles.chip, favCuisines.includes(c) && styles.chipActive]}
                    textStyle={favCuisines.includes(c) ? { color: '#fff' } : { color: '#555' }}
                    showSelectedCheck={false}
                  >
                    {c}
                  </Chip>
                ))}
              </View>
            </Surface>

            <Surface style={styles.section} elevation={1}>
              <Text variant="titleSmall" style={styles.secLabel}>Allergies (optional)</Text>
              <View style={styles.chipRow}>
                {allergies.map(a => (
                  <Chip key={a} onClose={() => setAllergies(prev => prev.filter(x => x !== a))} style={styles.allergyChip} textStyle={{ color: '#C62828' }}>
                    {a}
                  </Chip>
                ))}
              </View>
              <View style={styles.addRow}>
                <TextInput
                  dense mode="outlined" placeholder="e.g. peanuts, shellfish"
                  value={newAllergy} onChangeText={setNewAllergy} style={styles.addInput}
                  outlineStyle={{ borderRadius: 12 }} outlineColor="#E0E0E0"
                  onSubmitEditing={addAllergy}
                />
                <IconButton icon="plus-circle" iconColor="#F44336" size={28} onPress={addAllergy} style={{ margin: 0 }} />
              </View>
            </Surface>
          </View>
        )}

        {/* ── Step 2: Kitchen Staples ────────────────── */}
        {step === 2 && (
          <View style={styles.stepWrap}>
            <Text variant="headlineSmall" style={styles.stepTitle}>Kitchen Staples</Text>
            <Text variant="bodyMedium" style={styles.stepSub}>
              Select items already in your kitchen ({selectedCount} selected)
            </Text>

            {categories.map(cat => {
              const catItems = staples.filter(s => s.category === cat);
              const allSelected = catItems.every(s => s.selected);
              return (
                <Surface key={cat} style={styles.catSection} elevation={1}>
                  <View style={styles.catHeader}>
                    <Text variant="titleSmall" style={styles.catLabel}>{cat}</Text>
                    <Pressable onPress={() => selectAllCategory(cat, !allSelected)}>
                      <Text style={styles.selectAllText}>{allSelected ? 'Deselect All' : 'Select All'}</Text>
                    </Pressable>
                  </View>
                  {catItems.map((item) => {
                    const idx = staples.indexOf(item);
                    return (
                      <Pressable key={idx} onPress={() => toggleStaple(idx)} style={styles.stapleRow}>
                        <Checkbox status={item.selected ? 'checked' : 'unchecked'} onPress={() => toggleStaple(idx)} color="#4CAF50" />
                        <View style={styles.stapleInfo}>
                          <Text variant="bodyMedium" style={[styles.stapleName, !item.selected && { color: '#aaa' }]}>
                            {item.name}
                          </Text>
                          <Text variant="bodySmall" style={styles.stapleQty}>{item.qty} {item.unit}</Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </Surface>
              );
            })}
          </View>
        )}
      </ScrollView>

      {/* Bottom actions */}
      <Surface style={styles.bottomBar} elevation={4}>
        {step > 0 && (
          <Button mode="outlined" onPress={() => setStep(step - 1)} style={styles.backBtn}>
            Back
          </Button>
        )}
        <View style={{ flex: 1 }} />
        {step < STEPS.length - 1 ? (
          <Button
            mode="contained"
            onPress={() => setStep(step + 1)}
            style={styles.nextBtn}
            contentStyle={{ paddingVertical: 4 }}
          >
            {step === 0 ? "Let's Go" : 'Next'}
          </Button>
        ) : (
          <Button
            mode="contained"
            onPress={handleComplete}
            loading={saving}
            disabled={saving}
            style={styles.nextBtn}
            contentStyle={{ paddingVertical: 4 }}
          >
            {saving ? 'Setting up...' : `Finish Setup (${selectedCount} items)`}
          </Button>
        )}
      </Surface>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F9FA' },
  progressWrap: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 },
  progressBar: { height: 6, backgroundColor: '#E0E0E0', borderRadius: 3 },
  progressFill: { height: 6, backgroundColor: '#4CAF50', borderRadius: 3 },
  progressText: { color: '#999', fontSize: 12, marginTop: 6, textAlign: 'center' },

  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 24 },
  stepWrap: { paddingHorizontal: 20 },

  // Welcome
  welcomeCard: { backgroundColor: '#fff', borderRadius: 20, padding: 32, alignItems: 'center', marginTop: 20 },
  welcomeLogo: { width: 220, height: 176, borderRadius: 18, overflow: 'hidden', backgroundColor: '#000' },
  welcomeTitle: { fontWeight: '800', color: '#333', marginTop: 16, textAlign: 'center' },
  welcomeDesc: { color: '#888', marginTop: 10, textAlign: 'center', lineHeight: 22 },
  featureList: { marginTop: 28, gap: 14 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  featureIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#E8F5E9', justifyContent: 'center', alignItems: 'center' },
  featureText: { color: '#555', fontSize: 15, fontWeight: '500' },

  // Steps
  stepTitle: { fontWeight: '800', color: '#333', marginTop: 12 },
  stepSub: { color: '#888', marginTop: 4, marginBottom: 16 },

  section: { backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 12 },
  secLabel: { fontWeight: '700', color: '#333', marginBottom: 12 },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { backgroundColor: '#F5F5F5' },
  chipActive: { backgroundColor: '#4CAF50' },
  allergyChip: { backgroundColor: '#FFEBEE' },

  spicePill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#F5F5F5', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12 },
  spicePillActive: { backgroundColor: '#4CAF50' },
  spiceEmoji: { fontSize: 14 },
  spiceText: { fontSize: 13, color: '#666', fontWeight: '600' },

  counterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 20 },
  counterBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#F5F5F5', justifyContent: 'center', alignItems: 'center' },
  counterVal: { fontWeight: '800', minWidth: 40, textAlign: 'center', color: '#333' },

  addRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  addInput: { flex: 1, marginRight: 4, backgroundColor: '#fff' },

  // Staples
  catSection: { backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 12 },
  catHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  catLabel: { fontWeight: '700', color: '#333' },
  selectAllText: { color: '#4CAF50', fontWeight: '600', fontSize: 13 },
  stapleRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  stapleInfo: { flex: 1, marginLeft: 4 },
  stapleName: { fontWeight: '500', color: '#333' },
  stapleQty: { color: '#999', marginTop: 1 },

  // Bottom
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: '#fff',
    borderTopWidth: 0,
  },
  backBtn: { borderRadius: 12 },
  nextBtn: { borderRadius: 12, backgroundColor: '#4CAF50', minWidth: 140 },
});
