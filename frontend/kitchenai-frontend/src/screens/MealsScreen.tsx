import React, { useState, useCallback } from 'react';
import {
  StyleSheet,
  View,
  ScrollView,
  RefreshControl,
} from 'react-native';
import {
  Text,
  Card,
  Button,
  Chip,
  ActivityIndicator,
  Surface,
  Divider,
  TextInput,
} from 'react-native-paper';
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

const CATEGORY_ICONS: Record<string, string> = {
  meal_of_day: 'star-circle',
  most_healthy: 'heart-pulse',
  most_tasty: 'fire',
  long_lasting: 'clock-outline',
  rescue_meal: 'alert-circle-outline',
};

const CATEGORY_COLORS: Record<string, string> = {
  meal_of_day: '#FF9800',
  most_healthy: '#4CAF50',
  most_tasty: '#F44336',
  long_lasting: '#2196F3',
  rescue_meal: '#9C27B0',
};

const DIFFICULTY_COLORS: Record<string, string> = {
  easy: '#4CAF50',
  medium: '#FF9800',
  hard: '#F44336',
};

export function MealsScreen() {
  const [categories, setCategories] = useState<MealCategory[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generated, setGenerated] = useState(false);
  const [inventoryCount, setInventoryCount] = useState(0);
  const [userPrompt, setUserPrompt] = useState('');

  const generateMeals = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.getSmartMeals(userPrompt.trim() || undefined);
      setCategories(result.categories || []);
      setInventoryCount(result.inventory_items_used || 0);
      setGenerated(true);
    } catch (e: any) {
      setError(e.message || 'Could not generate meal suggestions.');
    } finally {
      setLoading(false);
    }
  }, [userPrompt]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await generateMeals();
    setRefreshing(false);
  }, [generateMeals]);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        generated ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} /> : undefined
      }
    >
      {/* Header */}
      <Surface style={styles.header} elevation={2}>
        <Text variant="headlineSmall" style={styles.headerTitle}>
          Smart Meal Planner
        </Text>
        <Text variant="bodyMedium" style={styles.headerSub}>
          AI-powered suggestions based on your kitchen inventory
        </Text>
      </Surface>

      {!generated && !loading && (
        <Card style={styles.ctaCard} mode="elevated">
          <Card.Content style={styles.ctaContent}>
            <Text variant="titleMedium" style={styles.ctaTitle}>
              What should I cook today?
            </Text>
            <Text variant="bodyMedium" style={styles.ctaDesc}>
              Our AI analyzes your inventory, expiry dates, dietary preferences, and cook skills to suggest the perfect meals.
            </Text>
            <View style={styles.ctaChips}>
              <Chip icon="star-circle" compact style={styles.ctaChip}>Meal of Day</Chip>
              <Chip icon="heart-pulse" compact style={styles.ctaChip}>Healthy</Chip>
              <Chip icon="fire" compact style={styles.ctaChip}>Tasty</Chip>
              <Chip icon="clock-outline" compact style={styles.ctaChip}>Meal Prep</Chip>
              <Chip icon="alert-circle-outline" compact style={styles.ctaChip}>Rescue</Chip>
            </View>
            <TextInput
              mode="outlined"
              placeholder="Any preference? e.g. something light, no onion today, want biryani..."
              value={userPrompt}
              onChangeText={setUserPrompt}
              multiline
              numberOfLines={2}
              style={styles.promptInput}
              outlineColor="#FFB74D"
              activeOutlineColor="#FF9800"
              left={<TextInput.Icon icon="message-text-outline" />}
            />
            <Button
              mode="contained"
              icon="robot"
              onPress={generateMeals}
              style={styles.generateBtn}
              contentStyle={styles.generateBtnContent}
              buttonColor="#FF9800"
            >
              Generate Meal Ideas
            </Button>
          </Card.Content>
        </Card>
      )}

      {loading && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" />
          <Text variant="bodyMedium" style={styles.loadingText}>
            AI is analyzing your kitchen...
          </Text>
          <Text variant="bodySmall" style={styles.loadingSubtext}>
            Checking inventory, expiry dates, and preferences
          </Text>
        </View>
      )}

      {error && (
        <Card style={styles.errorCard} mode="contained">
          <Card.Content>
            <Text variant="bodyMedium" style={styles.errorText}>{error}</Text>
            <Button mode="outlined" onPress={generateMeals} style={{ marginTop: 12 }}>
              Retry
            </Button>
          </Card.Content>
        </Card>
      )}

      {generated && !loading && categories.length > 0 && (
        <>
          <View style={styles.regenerateSection}>
            <TextInput
              mode="outlined"
              placeholder="Change preference and regenerate..."
              value={userPrompt}
              onChangeText={setUserPrompt}
              style={styles.promptInputSmall}
              outlineColor="#FFB74D"
              activeOutlineColor="#FF9800"
              dense
              right={<TextInput.Icon icon="refresh" onPress={generateMeals} />}
            />
            <View style={styles.infoRow}>
              <Chip icon="food-variant" compact>
                {inventoryCount} items in inventory
              </Chip>
              <Button
                mode="text"
                icon="refresh"
                compact
                onPress={generateMeals}
              >
                Regenerate
              </Button>
            </View>
          </View>

          {categories.map((category) => (
            <View key={category.id} style={styles.categorySection}>
              <View style={styles.categoryHeader}>
                <View
                  style={[
                    styles.categoryDot,
                    { backgroundColor: CATEGORY_COLORS[category.id] || '#666' },
                  ]}
                />
                <View style={styles.categoryTitleBlock}>
                  <Text variant="titleLarge" style={styles.categoryTitle}>
                    {category.title}
                  </Text>
                  <Text variant="bodySmall" style={styles.categoryDesc}>
                    {category.description}
                  </Text>
                </View>
              </View>

              {category.meals?.map((meal, idx) => (
                <Card key={`${category.id}-${idx}`} style={styles.mealCard} mode="elevated">
                  <Card.Content>
                    <Text variant="titleMedium" style={styles.mealName}>
                      {meal.name}
                    </Text>
                    <Text variant="bodyMedium" style={styles.mealDesc}>
                      {meal.description}
                    </Text>

                    <View style={styles.mealMeta}>
                      <Chip
                        icon="clock-outline"
                        compact
                        style={styles.metaChip}
                        textStyle={styles.metaChipText}
                      >
                        {meal.cooking_time_mins} min
                      </Chip>
                      <Chip
                        compact
                        style={[
                          styles.metaChip,
                          { backgroundColor: (DIFFICULTY_COLORS[meal.difficulty] || '#666') + '20' },
                        ]}
                        textStyle={[
                          styles.metaChipText,
                          { color: DIFFICULTY_COLORS[meal.difficulty] || '#666' },
                        ]}
                      >
                        {meal.difficulty}
                      </Chip>
                    </View>

                    <View style={styles.ingredientsRow}>
                      {meal.ingredients?.map((ing, i) => (
                        <Chip
                          key={i}
                          compact
                          style={styles.ingredientChip}
                          textStyle={styles.ingredientChipText}
                        >
                          {ing}
                        </Chip>
                      ))}
                    </View>

                    {meal.items_to_order && meal.items_to_order.length > 0 && (
                      <View style={styles.orderSection}>
                        <Text variant="labelSmall" style={styles.orderLabel}>
                          Need to order:
                        </Text>
                        <View style={styles.ingredientsRow}>
                          {meal.items_to_order.map((item, i) => (
                            <Chip
                              key={i}
                              compact
                              icon="cart-outline"
                              style={styles.orderChip}
                              textStyle={styles.orderChipText}
                            >
                              {item}
                            </Chip>
                          ))}
                        </View>
                      </View>
                    )}

                    <Surface style={styles.whyBox} elevation={0}>
                      <Text variant="labelSmall" style={styles.whyLabel}>
                        Why this meal?
                      </Text>
                      <Text variant="bodySmall" style={styles.whyText}>
                        {meal.why_this_meal}
                      </Text>
                    </Surface>

                    {meal.nutrition_notes ? (
                      <Text variant="bodySmall" style={styles.nutritionText}>
                        {meal.nutrition_notes}
                      </Text>
                    ) : null}
                  </Card.Content>
                </Card>
              ))}

              <Divider style={styles.categoryDivider} />
            </View>
          ))}
        </>
      )}

      {generated && !loading && categories.length === 0 && !error && (
        <Card style={styles.emptyCard} mode="elevated">
          <Card.Content>
            <Text variant="titleMedium" style={{ textAlign: 'center' }}>
              No items in inventory
            </Text>
            <Text variant="bodyMedium" style={{ textAlign: 'center', color: '#666', marginTop: 8 }}>
              Add items to your inventory first by scanning a bill or adding manually.
            </Text>
          </Card.Content>
        </Card>
      )}

      <View style={{ height: 32 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FAFAFA',
  },
  content: {
    paddingBottom: 24,
  },
  header: {
    backgroundColor: '#FF9800',
    padding: 20,
    paddingTop: 12,
  },
  headerTitle: {
    color: '#fff',
    fontWeight: 'bold',
  },
  headerSub: {
    color: 'rgba(255,255,255,0.85)',
    marginTop: 4,
  },
  ctaCard: {
    margin: 16,
  },
  ctaContent: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  ctaTitle: {
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 8,
  },
  ctaDesc: {
    textAlign: 'center',
    color: '#666',
    marginBottom: 16,
    lineHeight: 22,
  },
  ctaChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 6,
    marginBottom: 20,
  },
  ctaChip: {
    height: 32,
  },
  promptInput: {
    width: '100%',
    marginBottom: 16,
    backgroundColor: '#fff',
  },
  promptInputSmall: {
    marginHorizontal: 16,
    marginTop: 12,
    backgroundColor: '#fff',
  },
  regenerateSection: {
    paddingTop: 4,
  },
  generateBtn: {
    borderRadius: 12,
    width: '100%',
  },
  generateBtnContent: {
    paddingVertical: 6,
  },
  loadingContainer: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  loadingText: {
    marginTop: 16,
    fontWeight: '600',
  },
  loadingSubtext: {
    marginTop: 4,
    color: '#999',
  },
  errorCard: {
    margin: 16,
    backgroundColor: '#FFEBEE',
  },
  errorText: {
    color: '#C62828',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  categorySection: {
    paddingHorizontal: 16,
  },
  categoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    marginBottom: 12,
  },
  categoryDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 10,
  },
  categoryTitleBlock: {
    flex: 1,
  },
  categoryTitle: {
    fontWeight: 'bold',
  },
  categoryDesc: {
    color: '#888',
  },
  mealCard: {
    marginBottom: 12,
  },
  mealName: {
    fontWeight: 'bold',
    marginBottom: 4,
  },
  mealDesc: {
    color: '#555',
    marginBottom: 10,
  },
  mealMeta: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  metaChip: {
    height: 28,
  },
  metaChipText: {
    fontSize: 12,
  },
  ingredientsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 12,
  },
  ingredientChip: {
    height: 26,
    backgroundColor: '#E8F5E9',
  },
  ingredientChipText: {
    fontSize: 11,
    color: '#2E7D32',
  },
  whyBox: {
    backgroundColor: '#FFF8E1',
    padding: 12,
    borderRadius: 8,
  },
  whyLabel: {
    color: '#F57F17',
    fontWeight: 'bold',
    marginBottom: 4,
  },
  whyText: {
    color: '#795548',
    lineHeight: 18,
  },
  nutritionText: {
    color: '#4CAF50',
    marginTop: 8,
    fontStyle: 'italic',
  },
  orderSection: {
    marginBottom: 12,
  },
  orderLabel: {
    color: '#E65100',
    fontWeight: 'bold',
    marginBottom: 6,
  },
  orderChip: {
    height: 26,
    backgroundColor: '#FFF3E0',
    borderColor: '#FFB74D',
    borderWidth: 1,
  },
  orderChipText: {
    fontSize: 11,
    color: '#E65100',
  },
  categoryDivider: {
    marginVertical: 8,
  },
  emptyCard: {
    margin: 16,
    paddingVertical: 24,
  },
});
