import React, { useState, useCallback } from 'react';
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
} from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import * as api from '../services/api';

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

export function MealsScreen() {
  const navigation = useNavigation<any>();
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [result, setResult] = useState<MealCategory | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userPrompt, setUserPrompt] = useState('');
  const [inventoryCount, setInventoryCount] = useState(0);

  const sendToCook = (meal: SmartMeal) => {
    const instructions = [
      meal.description,
      `Ingredients: ${(meal.ingredients || []).join(', ')}`,
      `Cooking time: ${meal.cooking_time_mins} min`,
      meal.why_this_meal ? `Note: ${meal.why_this_meal}` : '',
    ].filter(Boolean).join('\n');
    navigation.navigate('Cook', { dishName: meal.name, instructions });
  };

  const generateForCategory = useCallback(async (catId: string) => {
    setSelectedCategory(catId);
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.getSmartMeals(catId, userPrompt.trim() || undefined);
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
  };

  const activeCat = CATEGORIES.find((c) => c.id === selectedCategory);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
      {/* Header */}
      <View style={[styles.header, activeCat ? { backgroundColor: activeCat.color } : {}]}>
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

      {/* Category selection */}
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

          {CATEGORIES.map((cat) => (
            <Pressable key={cat.id} onPress={() => generateForCategory(cat.id)}>
              <Surface style={styles.catCard} elevation={1}>
                <View style={[styles.catIcon, { backgroundColor: cat.bg }]}>
                  <IconButton icon={cat.icon} iconColor={cat.color} size={26} style={{ margin: 0 }} />
                </View>
                <View style={styles.catText}>
                  <Text variant="titleSmall" style={styles.catTitle}>{cat.title}</Text>
                  <Text variant="bodySmall" style={styles.catSub}>{cat.subtitle}</Text>
                </View>
                <IconButton icon="chevron-right" iconColor="#ccc" size={22} style={{ margin: 0 }} />
              </Surface>
            </Pressable>
          ))}
        </>
      )}

      {/* Loading */}
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

      {/* Error */}
      {error && !loading && (
        <Surface style={styles.errorCard} elevation={1}>
          <IconButton icon="alert-circle" iconColor="#C62828" size={28} style={{ margin: 0 }} />
          <Text variant="bodyMedium" style={styles.errorText}>{error}</Text>
          <View style={styles.errorActions}>
            <Button mode="contained" compact onPress={() => selectedCategory && generateForCategory(selectedCategory)} buttonColor="#C62828">
              Retry
            </Button>
            <Button mode="text" compact onPress={goBack} textColor="#888">Back</Button>
          </View>
        </Surface>
      )}

      {/* Results */}
      {result && !loading && (
        <View style={styles.resultWrap}>
          {/* Preference + regenerate */}
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
                  onPress={() => selectedCategory && generateForCategory(selectedCategory)}
                />
              }
            />
          </View>

          {inventoryCount > 0 && (
            <Chip icon="food-variant" compact style={styles.invChip} textStyle={{ fontSize: 12 }}>
              Using {inventoryCount} inventory items
            </Chip>
          )}

          {/* Meal cards */}
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
            onPress={() => selectedCategory && generateForCategory(selectedCategory)}
            style={[styles.regenBtn, { backgroundColor: activeCat?.color || '#FF9800' }]}
          >
            <IconButton icon="refresh" iconColor="#fff" size={18} style={{ margin: 0 }} />
            <Text style={styles.regenBtnText}>Regenerate Ideas</Text>
          </Pressable>
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

  promptWrap: { paddingHorizontal: 20, paddingTop: 16 },
  promptInput: { backgroundColor: '#fff' },

  sectionLabel: { fontWeight: '700', color: '#333', paddingHorizontal: 20, marginTop: 20, marginBottom: 10 },

  catCard: {
    marginHorizontal: 20,
    marginBottom: 10,
    borderRadius: 16,
    backgroundColor: '#fff',
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
  },
  catIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  catText: { flex: 1 },
  catTitle: { fontWeight: '700', color: '#333' },
  catSub: { color: '#888', marginTop: 2 },

  loadingWrap: { paddingHorizontal: 20, paddingTop: 40 },
  loadingCard: {
    borderRadius: 20,
    backgroundColor: '#fff',
    padding: 40,
    alignItems: 'center',
  },
  loadingText: { marginTop: 20, fontWeight: '600', color: '#333' },
  loadingSub: { marginTop: 6, color: '#999' },

  errorCard: {
    margin: 20,
    borderRadius: 16,
    backgroundColor: '#FFEBEE',
    padding: 20,
    alignItems: 'center',
  },
  errorText: { color: '#C62828', marginTop: 8, textAlign: 'center' },
  errorActions: { flexDirection: 'row', gap: 12, marginTop: 16 },

  resultWrap: { paddingHorizontal: 20, paddingTop: 4 },

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
