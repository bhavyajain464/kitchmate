import React, { useState, useCallback, useEffect } from 'react';
import {
  StyleSheet,
  View,
  ScrollView,
  Pressable,
} from 'react-native';
import {
  Text,
  Card,
  Chip,
  ActivityIndicator,
  Surface,
  TextInput,
  IconButton,
  Button,
  Portal,
  Modal,
  Divider,
} from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as api from '../services/api';
import { CookedLogEntry } from '../types';
import { layout } from '../theme';

const SOURCE_LABELS: Record<string, string> = {
  manual: 'Logged',
  'ai-suggested': 'Meal idea',
  'meal-sent': 'Sent to cook',
  'cook-sent': 'Cook message',
  'whatsapp-parsed': 'WhatsApp',
};

const MEAL_SLOTS = [
  { id: 'breakfast', label: 'Breakfast' },
  { id: 'lunch', label: 'Lunch' },
  { id: 'dinner', label: 'Dinner' },
  { id: 'snack', label: 'Snack' },
] as const;

function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const GRID_GAP = 14;
const GRID_PAD = 18;

interface SmartMeal {
  name: string;
  description: string;
  ingredients: string[];
  items_to_order?: string[];
  cooking_time_mins: number;
  difficulty: string;
  why_this_meal: string;
  nutrition_notes?: string;
}

interface MealCategory {
  id: string;
  title: string;
  description: string;
  meals: SmartMeal[];
}

const CATEGORIES = [
  { id: 'daily', title: 'Daily', subtitle: 'Just a dish idea', icon: 'calendar-today', color: '#795548', bg: '#EFEBE9' },
  { id: 'rescue_meal', title: 'Rescue', subtitle: 'Use expiring items', icon: 'alert-circle-outline', color: '#9C27B0', bg: '#F3E5F5' },
  { id: 'meal_of_day', title: 'Meal of Day', subtitle: 'Best from inventory', icon: 'star-circle', color: '#FF9800', bg: '#FFF3E0' },
  { id: 'most_healthy', title: 'Healthy', subtitle: 'Nutrient-rich picks', icon: 'heart-pulse', color: '#4CAF50', bg: '#E8F5E9' },
  { id: 'most_tasty', title: 'Tasty', subtitle: 'Crowd pleasers', icon: 'fire', color: '#F44336', bg: '#FFEBEE' },
  { id: 'long_lasting', title: 'Meal Prep', subtitle: 'Cook now, eat later', icon: 'clock-outline', color: '#2196F3', bg: '#E3F2FD' },
];

const DIFFICULTY_COLORS: Record<string, string> = {
  easy: '#4CAF50',
  medium: '#FF9800',
  hard: '#F44336',
};

function CategoryBox({
  icon,
  label,
  subtitle,
  color,
  bg,
  onPress,
}: {
  icon: string;
  label: string;
  subtitle: string;
  color: string;
  bg: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.gridItem, pressed && { opacity: 0.88 }]}>
      <Surface style={[styles.gridSurface, { backgroundColor: bg }]} elevation={1}>
        <View style={styles.gridIconWrap}>
          <IconButton icon={icon} iconColor={color} size={28} style={{ margin: 0 }} />
        </View>
        <Text variant="titleSmall" style={[styles.gridLabel, { color }]}>{label}</Text>
        <Text variant="bodySmall" style={styles.gridSub}>{subtitle}</Text>
      </Surface>
    </Pressable>
  );
}

export function MealsScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [result, setResult] = useState<MealCategory | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userPrompt, setUserPrompt] = useState('');
  const [inventoryCount, setInventoryCount] = useState(0);
  const [mealHistory, setMealHistory] = useState<CookedLogEntry[]>([]);
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [addDishName, setAddDishName] = useState('');
  const [addMealSlot, setAddMealSlot] = useState<string>('');
  const [addCookedOn, setAddCookedOn] = useState(todayISO);
  const [addNotes, setAddNotes] = useState('');
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const refreshHistory = useCallback(async () => {
    try {
      const res = await api.getCookedHistory();
      setMealHistory(res.entries || []);
    } catch {
      setMealHistory([]);
    }
  }, []);

  useEffect(() => {
    refreshHistory();
  }, [refreshHistory]);

  const openAddMeal = () => {
    setAddDishName('');
    setAddMealSlot('');
    setAddCookedOn(todayISO());
    setAddNotes('');
    setAddError(null);
    setAddModalVisible(true);
  };

  const closeAddMeal = () => {
    setAddModalVisible(false);
    setAddError(null);
  };

  const handleAddMeal = async () => {
    const name = addDishName.trim();
    if (!name) {
      setAddError('Enter what you ate.');
      return;
    }
    const cookedOn = addCookedOn.trim();
    if (cookedOn && !/^\d{4}-\d{2}-\d{2}$/.test(cookedOn)) {
      setAddError('Date must be YYYY-MM-DD.');
      return;
    }
    setAddSaving(true);
    setAddError(null);
    try {
      await api.logCookedDish({
        dish_name: name,
        meal_slot: addMealSlot || undefined,
        source: 'manual',
        notes: addNotes.trim() || undefined,
        cooked_on: cookedOn || todayISO(),
      });
      closeAddMeal();
      await refreshHistory();
    } catch {
      setAddError('Could not save. Check you are signed in and the backend is running.');
    } finally {
      setAddSaving(false);
    }
  };

  const sendToCook = (meal: SmartMeal) => {
    const instructions = [
      meal.description,
      `Ingredients: ${(meal.ingredients || []).join(', ')}`,
      `Cooking time: ${meal.cooking_time_mins} min`,
      meal.why_this_meal ? `Note: ${meal.why_this_meal}` : '',
    ].filter(Boolean).join('\n');
    navigation.navigate('Cook', { dishName: meal.name, instructions });
  };

  const generateForCategory = useCallback(async (catId: string, excludeDish?: string) => {
    setSelectedCategory(catId);
    setLoading(true);
    setError(null);
    if (!excludeDish) {
      setResult(null);
    }
    try {
      const res = await api.getSmartMeals(
        catId,
        userPrompt.trim() || undefined,
        excludeDish,
      );
      const categories: MealCategory[] = res.categories || [];
      const match = categories.find((c) => c.id === catId) || categories[0] || null;
      setResult(match);
      setInventoryCount(res.inventory_items_used || 0);
    } catch (e: any) {
      setError(e.message || 'Failed to generate suggestions.');
    } finally {
      setLoading(false);
    }
  }, [userPrompt]);

  const goBack = () => {
    setSelectedCategory(null);
    setResult(null);
    setError(null);
    refreshHistory();
  };

  const activeCat = CATEGORIES.find((c) => c.id === selectedCategory);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.scrollContent, { paddingBottom: layout.tabBarHeight + insets.bottom + 24 }]}
      showsVerticalScrollIndicator={false}
    >
      <View
        style={[
          styles.header,
          { paddingTop: insets.top + 14 },
          activeCat ? { backgroundColor: activeCat.color } : {},
        ]}
      >
        <View style={styles.headerContent}>
          {selectedCategory && (
            <Pressable onPress={goBack} style={styles.backRow}>
              <IconButton icon="arrow-left" iconColor="#fff" size={20} style={{ margin: 0 }} />
              <Text style={styles.backText}>Back</Text>
            </Pressable>
          )}
          <Text variant="headlineSmall" style={styles.headerTitle}>
            {activeCat ? activeCat.title : 'Smart Meals'}
          </Text>
          <Text variant="bodyMedium" style={styles.headerSub}>
            {activeCat ? activeCat.subtitle : 'AI-powered meal ideas from your kitchen'}
          </Text>
        </View>
      </View>

      {!selectedCategory && !loading && (
        <>
          <View style={styles.promptWrap}>
            <TextInput
              mode="outlined"
              placeholder="Any preference? e.g. italian, something light..."
              value={userPrompt}
              onChangeText={setUserPrompt}
              style={styles.promptInput}
              outlineColor="#E0E0E0"
              activeOutlineColor="#FF9800"
              outlineStyle={{ borderRadius: 14 }}
              dense
              left={<TextInput.Icon icon="message-text-outline" color="#bbb" />}
            />
          </View>

          <Text variant="titleMedium" style={styles.sectionLabel}>What are you looking for?</Text>

          <View style={styles.grid}>
            {CATEGORIES.map((cat) => (
              <CategoryBox
                key={cat.id}
                icon={cat.icon}
                label={cat.title}
                subtitle={cat.subtitle}
                color={cat.color}
                bg={cat.bg}
                onPress={() => generateForCategory(cat.id)}
              />
            ))}
          </View>

        </>
      )}

      {loading && (
        <View style={styles.loadingWrap}>
          <Surface style={styles.loadingCard} elevation={2}>
            <ActivityIndicator size="large" color={activeCat?.color || '#FF9800'} />
            <Text variant="titleSmall" style={styles.loadingText}>
              Finding {activeCat?.title || ''} ideas...
            </Text>
            <Text variant="bodySmall" style={styles.loadingSub}>
              Analyzing your inventory & preferences
            </Text>
          </Surface>
        </View>
      )}

      {error && !loading && (
        <Surface style={styles.errorCard} elevation={1}>
          <IconButton icon="alert-circle" iconColor="#C62828" size={28} style={{ margin: 0 }} />
          <Text variant="bodyMedium" style={styles.errorText}>{error}</Text>
          <View style={styles.errorActions}>
            <Button
              mode="contained"
              compact
              onPress={() =>
                selectedCategory &&
                generateForCategory(selectedCategory, result?.meals?.[0]?.name)
              }
              buttonColor="#C62828"
            >
              Retry
            </Button>
            <Button mode="text" compact onPress={goBack} textColor="#888">Back</Button>
          </View>
        </Surface>
      )}

      {result && !loading && (
        <View style={styles.resultWrap}>
          <View style={styles.regenRow}>
            <TextInput
              mode="outlined"
              placeholder="Change preference..."
              value={userPrompt}
              onChangeText={setUserPrompt}
              style={styles.regenInput}
              outlineColor="#E0E0E0"
              activeOutlineColor={activeCat?.color || '#FF9800'}
              outlineStyle={{ borderRadius: 12 }}
              dense
              right={
                <TextInput.Icon
                  icon="refresh"
                  color={activeCat?.color}
                  onPress={() =>
                    selectedCategory &&
                    generateForCategory(selectedCategory, result?.meals?.[0]?.name)
                  }
                />
              }
            />
          </View>

          {inventoryCount > 0 && (
            <Chip icon="food-variant" compact style={styles.invChip} textStyle={{ fontSize: 12 }}>
              Using {inventoryCount} inventory items
            </Chip>
          )}

          {result.meals?.map((meal, idx) => (
            <Card key={idx} style={styles.mealCard} mode="elevated">
              <Card.Content>
                <View style={styles.mealHeader}>
                  <Text variant="titleMedium" style={styles.mealName}>{meal.name}</Text>
                  <View style={[styles.diffBadge, { backgroundColor: (DIFFICULTY_COLORS[meal.difficulty] || '#888') + '18' }]}>
                    <Text style={[styles.diffText, { color: DIFFICULTY_COLORS[meal.difficulty] || '#888' }]}>
                      {meal.difficulty}
                    </Text>
                  </View>
                </View>

                <Text variant="bodyMedium" style={styles.mealDesc}>{meal.description}</Text>

                <View style={styles.metaRow}>
                  <View style={styles.metaItem}>
                    <IconButton icon="clock-outline" size={16} iconColor="#888" style={{ margin: 0 }} />
                    <Text variant="bodySmall" style={styles.metaText}>{meal.cooking_time_mins} min</Text>
                  </View>
                </View>

                <Text variant="labelSmall" style={styles.ingLabel}>Ingredients</Text>
                <View style={styles.chipWrap}>
                  {meal.ingredients?.map((ing, i) => (
                    <Chip key={i} compact style={styles.ingChip} textStyle={styles.ingChipText}>{ing}</Chip>
                  ))}
                </View>

                {meal.items_to_order && meal.items_to_order.length > 0 && (
                  <>
                    <Text variant="labelSmall" style={styles.orderLabel}>Need to order</Text>
                    <View style={styles.chipWrap}>
                      {meal.items_to_order.map((item, i) => (
                        <Chip key={i} compact icon="cart-outline" style={styles.orderChip} textStyle={styles.orderChipText}>{item}</Chip>
                      ))}
                    </View>
                  </>
                )}

                <Surface style={styles.whyBox} elevation={0}>
                  <Text variant="labelSmall" style={styles.whyLabel}>Why this meal?</Text>
                  <Text variant="bodySmall" style={styles.whyText}>{meal.why_this_meal}</Text>
                </Surface>

                {meal.nutrition_notes ? (
                  <Text variant="bodySmall" style={styles.nutritionText}>{meal.nutrition_notes}</Text>
                ) : null}

                <Button
                  mode="contained"
                  icon="chef-hat"
                  compact
                  onPress={() => sendToCook(meal)}
                  style={styles.cookBtn}
                  buttonColor="#25D366"
                  contentStyle={{ paddingVertical: 2 }}
                >
                  Send to Cook
                </Button>
              </Card.Content>
            </Card>
          ))}

          <Pressable
            onPress={() =>
              selectedCategory &&
              generateForCategory(selectedCategory, result?.meals?.[0]?.name)
            }
            style={[styles.regenBtn, { backgroundColor: activeCat?.color || '#FF9800' }]}
          >
            <IconButton icon="refresh" iconColor="#fff" size={18} style={{ margin: 0 }} />
            <Text style={styles.regenBtnText}>Regenerate Ideas</Text>
          </Pressable>
        </View>
      )}

      {!loading && (
        <View style={styles.historySection}>
          <View style={styles.historyHeader}>
            <View style={styles.historyHeaderText}>
              <Text variant="titleMedium" style={styles.historyTitle}>What you ate</Text>
              <Text variant="bodySmall" style={styles.historySubtitle}>Last 15 days</Text>
            </View>
            <Button
              mode="contained"
              icon="plus"
              compact
              onPress={openAddMeal}
              buttonColor="#FF9800"
              style={styles.addMealBtn}
              contentStyle={styles.addMealBtnContent}
            >
              Add meal
            </Button>
          </View>
          {mealHistory.length === 0 ? (
            <Surface style={styles.historyEmpty} elevation={0}>
              <IconButton icon="silverware-fork-knife" iconColor="#bbb" size={32} style={{ margin: 0 }} />
              <Text variant="bodySmall" style={styles.historyEmptyText}>
                Log what you actually ate — separate from AI meal ideas above.
              </Text>
              <Button mode="outlined" icon="plus" onPress={openAddMeal} style={styles.historyEmptyBtn} textColor="#FF9800">
                Add your first meal
              </Button>
            </Surface>
          ) : (
            mealHistory.map((entry) => (
              <Surface key={entry.id} style={styles.historyRow} elevation={0}>
                <View style={[styles.historyDot, { backgroundColor: '#FF9800' }]} />
                <View style={styles.historyBody}>
                  <Text variant="bodyMedium" style={styles.historyName} numberOfLines={1}>
                    {entry.dish_name}
                  </Text>
                  <Text variant="bodySmall" style={styles.historyMeta}>
                    {entry.cooked_on}
                    {entry.meal_slot ? ` · ${entry.meal_slot}` : ''}
                  </Text>
                </View>
                {entry.source !== 'manual' ? (
                  <Chip compact style={styles.sourceChip} textStyle={styles.sourceChipText}>
                    {SOURCE_LABELS[entry.source] || entry.source}
                  </Chip>
                ) : null}
              </Surface>
            ))
          )}
        </View>
      )}

      <View style={{ height: 32 }} />

      <Portal>
        <Modal
          visible={addModalVisible}
          onDismiss={closeAddMeal}
          contentContainerStyle={styles.addModal}
        >
          <Text variant="titleLarge" style={styles.addModalTitle}>Add meal</Text>
          <Text variant="bodySmall" style={styles.addModalSub}>
            What you actually ate — saved for the last 15 days.
          </Text>
          <Divider style={styles.addModalDivider} />

          <TextInput
            label="Dish name"
            value={addDishName}
            onChangeText={setAddDishName}
            mode="outlined"
            style={styles.addModalInput}
            placeholder="e.g. Dal, rice & sabzi"
            autoFocus
          />

          <Text variant="labelMedium" style={styles.slotLabel}>Meal (optional)</Text>
          <View style={styles.slotRow}>
            {MEAL_SLOTS.map((slot) => {
              const selected = addMealSlot === slot.id;
              return (
                <Chip
                  key={slot.id}
                  compact
                  selected={selected}
                  onPress={() => setAddMealSlot(selected ? '' : slot.id)}
                  style={[styles.slotChip, selected && styles.slotChipSelected]}
                  textStyle={selected ? styles.slotChipTextSelected : styles.slotChipText}
                >
                  {slot.label}
                </Chip>
              );
            })}
          </View>

          <TextInput
            label="Date eaten"
            value={addCookedOn}
            onChangeText={setAddCookedOn}
            mode="outlined"
            style={styles.addModalInput}
            placeholder="YYYY-MM-DD"
          />

          <TextInput
            label="Notes (optional)"
            value={addNotes}
            onChangeText={setAddNotes}
            mode="outlined"
            style={styles.addModalInput}
            placeholder="e.g. light dinner, guest portion"
            multiline
          />

          {addError ? (
            <Text variant="bodySmall" style={styles.addModalError}>{addError}</Text>
          ) : null}

          <View style={styles.addModalActions}>
            <Button mode="outlined" onPress={closeAddMeal} disabled={addSaving}>
              Cancel
            </Button>
            <Button mode="contained" onPress={handleAddMeal} loading={addSaving} buttonColor="#FF9800">
              Save
            </Button>
          </View>
        </Modal>
      </Portal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F9FA' },
  scrollContent: { paddingBottom: 24 },

  header: {
    backgroundColor: '#FF9800',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 20,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
  },
  headerContent: {},
  backRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4, marginLeft: -8 },
  backText: { color: 'rgba(255,255,255,0.9)', fontWeight: '600', fontSize: 14 },
  headerTitle: { color: '#fff', fontWeight: '800' },
  headerSub: { color: 'rgba(255,255,255,0.85)', marginTop: 4 },

  promptWrap: { paddingHorizontal: GRID_PAD, paddingTop: 16 },
  promptInput: { backgroundColor: '#fff' },

  sectionLabel: {
    fontWeight: '700',
    color: '#333',
    paddingHorizontal: GRID_PAD,
    marginTop: 20,
    marginBottom: 10,
  },

  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: GRID_PAD - GRID_GAP / 2,
  },
  gridItem: {
    width: '50%',
    padding: GRID_GAP / 2,
  },
  gridSurface: {
    borderRadius: 20,
    padding: 16,
    minHeight: 128,
    justifyContent: 'center',
  },
  gridIconWrap: {
    alignSelf: 'flex-start',
    marginBottom: 8,
  },
  gridLabel: {
    fontWeight: '700',
    fontSize: 15,
  },
  gridSub: {
    color: '#666',
    marginTop: 4,
    lineHeight: 17,
    fontSize: 12,
  },

  historySection: {
    paddingHorizontal: GRID_PAD,
    marginTop: 24,
    marginBottom: 8,
  },
  historyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    gap: 12,
  },
  historyHeaderText: {
    flex: 1,
  },
  historyTitle: {
    fontWeight: '700',
    color: '#333',
  },
  historySubtitle: {
    color: '#888',
    marginTop: 2,
  },
  addMealBtn: {
    borderRadius: 10,
  },
  addMealBtnContent: {
    paddingHorizontal: 4,
  },
  historyEmpty: {
    alignItems: 'center',
    padding: 24,
    borderRadius: 16,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#EEE',
  },
  historyEmptyText: {
    color: '#999',
    marginTop: 8,
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: 8,
  },
  historyEmptyBtn: {
    marginTop: 16,
    borderColor: '#FF9800',
  },
  addModal: {
    backgroundColor: '#fff',
    marginHorizontal: 20,
    borderRadius: 20,
    padding: 20,
    maxWidth: 440,
    alignSelf: 'center',
    width: '100%',
  },
  addModalTitle: {
    fontWeight: '800',
    color: '#333',
  },
  addModalSub: {
    color: '#888',
    marginTop: 4,
    lineHeight: 18,
  },
  addModalDivider: {
    marginVertical: 14,
  },
  addModalInput: {
    marginBottom: 12,
    backgroundColor: '#fff',
  },
  slotLabel: {
    color: '#666',
    marginBottom: 8,
  },
  slotRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  slotChip: {
    backgroundColor: '#F5F5F5',
  },
  slotChipSelected: {
    backgroundColor: '#FFF3E0',
  },
  slotChipText: {
    fontSize: 12,
    color: '#666',
  },
  slotChipTextSelected: {
    fontSize: 12,
    color: '#E65100',
  },
  addModalError: {
    color: '#C62828',
    marginBottom: 8,
  },
  addModalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 4,
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#F0F0F0',
  },
  historyDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 12,
  },
  historyBody: {
    flex: 1,
    marginRight: 8,
  },
  historyName: {
    fontWeight: '600',
    color: '#333',
  },
  historyMeta: {
    color: '#999',
    marginTop: 2,
    fontSize: 11,
  },
  sourceChip: {
    backgroundColor: '#FFF3E0',
    height: 26,
  },
  sourceChipText: {
    fontSize: 10,
    color: '#E65100',
  },

  loadingWrap: { paddingHorizontal: GRID_PAD, paddingTop: 40 },
  loadingCard: {
    borderRadius: 20,
    backgroundColor: '#fff',
    padding: 40,
    alignItems: 'center',
  },
  loadingText: { marginTop: 20, fontWeight: '600', color: '#333' },
  loadingSub: { marginTop: 6, color: '#999' },

  errorCard: {
    margin: GRID_PAD,
    borderRadius: 16,
    backgroundColor: '#FFEBEE',
    padding: 20,
    alignItems: 'center',
  },
  errorText: { color: '#C62828', marginTop: 8, textAlign: 'center' },
  errorActions: { flexDirection: 'row', gap: 12, marginTop: 16 },

  resultWrap: { paddingHorizontal: GRID_PAD, paddingTop: 4 },
  regenRow: { marginBottom: 12 },
  regenInput: { backgroundColor: '#fff' },
  invChip: { alignSelf: 'flex-start', marginBottom: 12, backgroundColor: '#E8F5E9' },

  mealCard: { marginBottom: 14, borderRadius: 16 },
  mealHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  mealName: { fontWeight: '700', color: '#333', flex: 1 },
  diffBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  diffText: { fontSize: 11, fontWeight: '700', textTransform: 'capitalize' },
  mealDesc: { color: '#555', lineHeight: 20, marginBottom: 12 },

  metaRow: { flexDirection: 'row', gap: 16, marginBottom: 12 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  metaText: { color: '#888' },

  ingLabel: { color: '#2E7D32', fontWeight: '700', marginBottom: 6 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  ingChip: { height: 28, backgroundColor: '#E8F5E9' },
  ingChipText: { fontSize: 11, color: '#2E7D32' },

  orderLabel: { color: '#E65100', fontWeight: '700', marginBottom: 6 },
  orderChip: { height: 28, backgroundColor: '#FFF3E0', borderColor: '#FFB74D', borderWidth: 1 },
  orderChipText: { fontSize: 11, color: '#E65100' },

  whyBox: { backgroundColor: '#FFF8E1', padding: 14, borderRadius: 12, marginBottom: 8 },
  whyLabel: { color: '#F57F17', fontWeight: '700', marginBottom: 4 },
  whyText: { color: '#795548', lineHeight: 18 },

  nutritionText: { color: '#4CAF50', fontStyle: 'italic', marginBottom: 8 },

  cookBtn: { marginTop: 8, alignSelf: 'flex-start', borderRadius: 10 },

  regenBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 14,
    marginTop: 4,
  },
  regenBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
