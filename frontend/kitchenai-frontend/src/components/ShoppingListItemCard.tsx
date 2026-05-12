import React from 'react';
import { StyleSheet } from 'react-native';
import { Card, Text, Chip } from 'react-native-paper';
import { ShoppingListItem, LowStockItem } from '../types';

interface ShoppingListItemCardProps {
  item: ShoppingListItem;
}

export function ShoppingListItemCard({ item }: ShoppingListItemCardProps) {
  const isCritical = item.priority === 1;

  return (
    <Card
      style={[styles.card, isCritical ? styles.criticalCard : styles.lowCard]}
      mode="elevated"
    >
      <Card.Content style={styles.content}>
        <Text variant="titleSmall" style={styles.name}>
          {item.name}
        </Text>
        <Text variant="bodySmall" style={styles.qty}>
          {item.quantity} {item.unit}
        </Text>
        <Chip
          compact
          style={[styles.chip, isCritical ? styles.criticalChip : styles.lowChip]}
          textStyle={styles.chipText}
        >
          {item.reason === 'low_stock' ? 'Low Stock' : 'Expiring Soon'}
        </Chip>
      </Card.Content>
    </Card>
  );
}

interface LowStockItemCardProps {
  item: LowStockItem;
}

export function LowStockItemCard({ item }: LowStockItemCardProps) {
  const isCritical = item.priority === 1;

  return (
    <Card
      style={[styles.card, isCritical ? styles.criticalCard : styles.lowCard]}
      mode="elevated"
    >
      <Card.Content style={styles.content}>
        <Text variant="titleSmall" style={styles.name}>
          {item.name}
        </Text>
        <Text variant="bodySmall" style={styles.qty}>
          {item.current_qty} {item.unit} (min: {item.min_qty})
        </Text>
        <Text variant="bodySmall" style={styles.recommended}>
          Recommended: {item.recommended_qty} {item.unit}
        </Text>
        <Chip
          compact
          style={[styles.chip, isCritical ? styles.criticalChip : styles.lowChip]}
          textStyle={styles.chipText}
        >
          {isCritical ? 'Critical' : 'Low Stock'}
        </Chip>
      </Card.Content>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: 8,
  },
  criticalCard: {
    borderLeftWidth: 4,
    borderLeftColor: '#F44336',
  },
  lowCard: {
    borderLeftWidth: 4,
    borderLeftColor: '#FF9800',
  },
  content: {
    gap: 4,
  },
  name: {
    fontWeight: '600',
  },
  qty: {
    color: '#666',
  },
  recommended: {
    color: '#999',
  },
  chip: {
    alignSelf: 'flex-start',
    marginTop: 4,
    height: 28,
  },
  criticalChip: {
    backgroundColor: '#FFEBEE',
  },
  lowChip: {
    backgroundColor: '#FFF3E0',
  },
  chipText: {
    fontSize: 11,
  },
});
