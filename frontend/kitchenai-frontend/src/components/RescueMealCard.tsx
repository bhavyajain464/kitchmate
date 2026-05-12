import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Card, Text, Chip, Button } from 'react-native-paper';
import { RescueMealSuggestion } from '../types';

interface RescueMealCardProps {
  meal: RescueMealSuggestion;
  onSendToCook?: (meal: RescueMealSuggestion) => void;
}

export function RescueMealCard({ meal, onSendToCook }: RescueMealCardProps) {
  return (
    <Card
      style={[
        styles.card,
        meal.can_cook ? styles.canCook : styles.cannotCook,
      ]}
      mode="elevated"
    >
      <Card.Content>
        <View style={styles.header}>
          <Text variant="titleMedium" style={styles.name}>
            {meal.meal_name}
          </Text>
          <Chip compact style={styles.scoreChip}>
            {meal.priority_score.toFixed(1)}
          </Chip>
        </View>

        <Text variant="bodySmall" style={styles.description}>
          {meal.description}
        </Text>

        <View style={styles.meta}>
          <Text variant="labelSmall" style={styles.metaText}>
            {meal.cooking_time} min
          </Text>
          <Text variant="labelSmall" style={styles.metaText}>
            {meal.can_cook ? 'Cook knows this' : 'Needs recipe'}
          </Text>
          {meal.cook_name && (
            <Text variant="labelSmall" style={styles.metaText}>
              {meal.cook_name}
            </Text>
          )}
        </View>

        <Text variant="bodySmall" style={styles.reason}>
          {meal.reason}
        </Text>

        <View style={styles.ingredients}>
          <Text variant="labelMedium">Ingredients:</Text>
          {meal.ingredients.slice(0, 3).map((ing, idx) => (
            <Text key={idx} variant="bodySmall" style={styles.ingredient}>
              {ing.name} ({ing.quantity} {ing.unit})
            </Text>
          ))}
          {meal.ingredients.length > 3 && (
            <Text variant="bodySmall" style={styles.moreText}>
              +{meal.ingredients.length - 3} more
            </Text>
          )}
        </View>
      </Card.Content>

      {onSendToCook && (
        <Card.Actions>
          <Button
            mode="contained"
            compact
            onPress={() => onSendToCook(meal)}
            icon="whatsapp"
          >
            Send to Cook
          </Button>
        </Card.Actions>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: 12,
  },
  canCook: {
    borderLeftWidth: 4,
    borderLeftColor: '#4CAF50',
  },
  cannotCook: {
    borderLeftWidth: 4,
    borderLeftColor: '#FF9800',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  name: {
    fontWeight: 'bold',
    flex: 1,
  },
  scoreChip: {
    backgroundColor: '#FFF3E0',
  },
  description: {
    color: '#666',
    marginBottom: 8,
  },
  meta: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 8,
  },
  metaText: {
    color: '#795548',
  },
  reason: {
    color: '#2196F3',
    fontStyle: 'italic',
    marginBottom: 8,
  },
  ingredients: {
    gap: 2,
  },
  ingredient: {
    color: '#666',
    marginLeft: 8,
  },
  moreText: {
    color: '#999',
    marginLeft: 8,
    fontStyle: 'italic',
  },
});
