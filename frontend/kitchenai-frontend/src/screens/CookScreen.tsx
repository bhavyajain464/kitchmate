import React, { useState, useEffect, useCallback } from 'react';
import { StyleSheet, View, ScrollView, Alert } from 'react-native';
import { Text, Card, Button, Divider, ActivityIndicator } from 'react-native-paper';
import { RescueMealCard } from '../components/RescueMealCard';
import * as api from '../services/api';
import { CookProfile, RescueMealResponse, RescueMealSuggestion, WhatsAppResult } from '../types';
import { colors } from '../theme';

const LANG_LABELS: Record<string, string> = { en: 'English', hi: 'Hindi', kn: 'Kannada' };

export function CookScreen() {
  const [cookProfile, setCookProfile] = useState<CookProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [whatsappLoading, setWhatsappLoading] = useState(false);
  const [whatsappResult, setWhatsappResult] = useState<WhatsAppResult | null>(null);

  const [rescueLoading, setRescueLoading] = useState(false);
  const [rescueResult, setRescueResult] = useState<RescueMealResponse | null>(null);
  const [rescueError, setRescueError] = useState<string | null>(null);

  const handleSendTestMessage = async () => {
    setWhatsappLoading(true);
    try {
      const result = await api.sendWhatsAppMessage(
        '+919876543210',
        'Hello from Kitchen AI! This is a test message.',
      );
      setWhatsappResult(result);
      Alert.alert('Sent!', 'Test message sent via WhatsApp.');
    } catch {
      Alert.alert('Failed', 'Could not send message.');
    } finally {
      setWhatsappLoading(false);
    }
  };

  const handleSendMealSuggestion = async () => {
    setWhatsappLoading(true);
    try {
      const result = await api.sendMealSuggestion(
        'Paneer Butter Masala',
        [
          { name: 'Paneer', quantity: 200, unit: 'grams' },
          { name: 'Tomato', quantity: 3, unit: 'pieces' },
          { name: 'Cream', quantity: 100, unit: 'ml' },
        ],
        30,
      );
      setWhatsappResult(result);
      Alert.alert('Sent!', 'Meal suggestion sent to cook.');
    } catch {
      Alert.alert('Failed', 'Could not send meal suggestion.');
    } finally {
      setWhatsappLoading(false);
    }
  };

  const handleSendDailyMenu = async () => {
    setWhatsappLoading(true);
    try {
      const result = await api.sendDailyMenu([
        { name: 'Paneer Butter Masala', cooking_time: 30 },
        { name: 'Dal Tadka', cooking_time: 25 },
        { name: 'Jeera Rice', cooking_time: 20 },
      ]);
      setWhatsappResult(result);
      Alert.alert('Sent!', 'Daily menu sent to cook.');
    } catch {
      Alert.alert('Failed', 'Could not send daily menu.');
    } finally {
      setWhatsappLoading(false);
    }
  };

  const handleSendMealToCook = async (meal: RescueMealSuggestion) => {
    setWhatsappLoading(true);
    try {
      const result = await api.sendMealSuggestion(
        meal.meal_name,
        meal.ingredients,
        meal.cooking_time,
      );
      setWhatsappResult(result);
      Alert.alert('Sent!', `${meal.meal_name} sent to cook via WhatsApp.`);
    } catch {
      Alert.alert('Failed', 'Could not send meal to cook.');
    } finally {
      setWhatsappLoading(false);
    }
  };

  const loadCookProfile = useCallback(async () => {
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

  useEffect(() => {
    loadCookProfile();
  }, [loadCookProfile]);

  const handleGetRescueMeals = async () => {
    setRescueLoading(true);
    setRescueError(null);
    setRescueResult(null);

    try {
      const result = await api.getRescueMealSuggestions(3);
      setRescueResult(result);
      Alert.alert(
        'Rescue Meals Generated!',
        `Found ${result.suggestions.length} suggestions from ${result.expiring_items.length} expiring items.`,
      );
    } catch {
      setRescueError('Could not generate rescue meal suggestions.');
      Alert.alert('Failed', 'Could not generate rescue meal suggestions.');
    } finally {
      setRescueLoading(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Cook Profile */}
      <Card style={styles.card} mode="elevated">
        <Card.Content>
          <Text variant="titleLarge" style={styles.cardTitle}>
            Cook Profile
          </Text>
          {profileLoading ? (
            <ActivityIndicator style={{ marginVertical: 12 }} />
          ) : cookProfile ? (
            <>
              <Text variant="bodyMedium" style={styles.meta}>
                Language: {LANG_LABELS[cookProfile.preferred_lang] || cookProfile.preferred_lang}
              </Text>
              <Text variant="bodyMedium" style={styles.meta}>
                Dishes Known: {cookProfile.dishes_known?.length || 0}
              </Text>
              {cookProfile.dishes_known?.length > 0 && (
                <Text variant="bodySmall" style={styles.meta}>
                  {cookProfile.dishes_known.join(', ')}
                </Text>
              )}
              {cookProfile.phone_number ? (
                <Text variant="bodyMedium" style={styles.available}>
                  WhatsApp: {cookProfile.phone_number}
                </Text>
              ) : null}
            </>
          ) : (
            <Text variant="bodyMedium" style={styles.meta}>
              No cook profile set up yet.
            </Text>
          )}
        </Card.Content>
      </Card>

      {/* WhatsApp Actions */}
      <Card style={styles.card} mode="elevated">
        <Card.Content>
          <Text variant="titleLarge" style={styles.cardTitle}>
            WhatsApp Communication
          </Text>
          <Text variant="bodySmall" style={styles.description}>
            Send messages to your cook in their preferred language.
          </Text>

          <View style={styles.buttonGroup}>
            <Button
              mode="contained"
              icon="message-text"
              onPress={handleSendTestMessage}
              loading={whatsappLoading}
              disabled={whatsappLoading}
              buttonColor={colors.whatsapp}
              style={styles.waBtn}
            >
              Send Test Message
            </Button>

            <Button
              mode="contained"
              icon="food"
              onPress={handleSendMealSuggestion}
              loading={whatsappLoading}
              disabled={whatsappLoading}
              buttonColor={colors.whatsapp}
              style={styles.waBtn}
            >
              Send Meal Suggestion
            </Button>

            <Button
              mode="contained"
              icon="clipboard-list"
              onPress={handleSendDailyMenu}
              loading={whatsappLoading}
              disabled={whatsappLoading}
              buttonColor={colors.whatsapp}
              style={styles.waBtn}
            >
              Send Daily Menu
            </Button>

            <Button
              mode="outlined"
              icon="test-tube"
              onPress={async () => {
                try {
                  const res = await api.testWhatsApp();
                  Alert.alert('WhatsApp Test', `Status: ${res.status}\n${res.message}`);
                } catch {
                  Alert.alert('Failed', 'Could not test WhatsApp integration.');
                }
              }}
              style={styles.waBtn}
            >
              Test Integration
            </Button>
          </View>

          {whatsappResult && (
            <Card style={styles.resultCard} mode="contained">
              <Card.Content>
                <Text variant="labelLarge" style={styles.resultLabel}>
                  WhatsApp Result
                </Text>
                <Text variant="bodySmall">
                  Status: {whatsappResult.status || 'unknown'}
                  {whatsappResult.message_id && `\nMessage ID: ${whatsappResult.message_id}`}
                  {whatsappResult.translated != null &&
                    `\nTranslated: ${whatsappResult.translated ? 'Yes' : 'No'}`}
                </Text>
              </Card.Content>
            </Card>
          )}
        </Card.Content>
      </Card>

      <Divider style={styles.divider} />

      {/* Rescue Meals */}
      <Card style={styles.card} mode="elevated">
        <Card.Content>
          <Text variant="titleLarge" style={styles.cardTitle}>
            Rescue Meal Suggestions
          </Text>
          <Text variant="bodySmall" style={styles.description}>
            AI-powered meal ideas using expiring items and cook skills.
          </Text>

          <Button
            mode="contained"
            icon="robot"
            onPress={handleGetRescueMeals}
            loading={rescueLoading}
            disabled={rescueLoading}
            buttonColor="#FF9800"
            style={styles.rescueBtn}
            contentStyle={styles.rescueBtnContent}
          >
            Generate Rescue Meals
          </Button>

          {rescueError && (
            <Text variant="bodySmall" style={styles.errorText}>
              {rescueError}
            </Text>
          )}
        </Card.Content>
      </Card>

      {rescueResult && (
        <View style={styles.rescueResults}>
          <Text variant="titleMedium" style={styles.rescueResultTitle}>
            {rescueResult.suggestions.length} Meal Suggestions
          </Text>
          <Text variant="bodySmall" style={styles.rescueResultSubtitle}>
            Based on {rescueResult.expiring_items.length} expiring items
            {rescueResult.cook_skills.length > 0 &&
              ` | Cook skills: ${rescueResult.cook_skills.join(', ')}`}
          </Text>

          {rescueResult.suggestions.map((meal) => (
            <RescueMealCard
              key={meal.meal_id}
              meal={meal}
              onSendToCook={handleSendMealToCook}
            />
          ))}

          {rescueResult.user_preferences && (
            <Card style={styles.prefsCard} mode="contained">
              <Card.Content>
                <Text variant="labelLarge">User Preferences</Text>
                <Text variant="bodySmall">
                  Cuisines:{' '}
                  {rescueResult.user_preferences.preferred_cuisines?.join(', ') || 'None'}
                  {'\n'}
                  Dietary:{' '}
                  {rescueResult.user_preferences.dietary_restrictions?.join(', ') || 'None'}
                </Text>
              </Card.Content>
            </Card>
          )}
        </View>
      )}

      <View style={styles.bottomSpacer} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F9FA',
  },
  content: {
    padding: 16,
  },
  card: {
    marginBottom: 16,
  },
  cardTitle: {
    fontWeight: 'bold',
    marginBottom: 8,
  },
  meta: {
    color: '#666',
    marginTop: 2,
  },
  available: {
    color: '#4CAF50',
    fontWeight: '600',
    marginTop: 8,
  },
  description: {
    color: '#666',
    marginBottom: 16,
  },
  buttonGroup: {
    gap: 10,
  },
  waBtn: {
    borderRadius: 10,
  },
  resultCard: {
    marginTop: 16,
    backgroundColor: '#E8F5E9',
  },
  resultLabel: {
    color: '#1B5E20',
    marginBottom: 4,
  },
  divider: {
    marginBottom: 16,
  },
  rescueBtn: {
    borderRadius: 12,
  },
  rescueBtnContent: {
    paddingVertical: 4,
  },
  errorText: {
    color: '#F44336',
    marginTop: 12,
  },
  rescueResults: {
    marginBottom: 16,
  },
  rescueResultTitle: {
    fontWeight: 'bold',
    marginBottom: 4,
  },
  rescueResultSubtitle: {
    color: '#666',
    marginBottom: 12,
  },
  prefsCard: {
    backgroundColor: '#E3F2FD',
  },
  bottomSpacer: {
    height: 24,
  },
});
