import React from 'react';
import { StyleSheet } from 'react-native';
import { Card, Text } from 'react-native-paper';
import { ExpiringItem } from '../types';

interface ExpiringItemCardProps {
  item: ExpiringItem;
  horizontal?: boolean;
}

export function ExpiringItemCard({ item, horizontal }: ExpiringItemCardProps) {
  const isUrgent = item.days_until_expiry <= 1;

  return (
    <Card
      style={[
        styles.card,
        horizontal && styles.horizontalCard,
        isUrgent && styles.urgentCard,
      ]}
      mode="elevated"
    >
      <Card.Content>
        <Text variant="titleSmall" style={styles.name}>
          {item.canonical_name}
        </Text>
        <Text variant="bodySmall" style={styles.qty}>
          {item.qty} {item.unit}
        </Text>
        <Text
          variant="labelSmall"
          style={[styles.expiry, isUrgent && styles.urgentText]}
        >
          {isUrgent
            ? 'Use Today!'
            : `${item.days_until_expiry} day${item.days_until_expiry !== 1 ? 's' : ''} left`}
        </Text>
      </Card.Content>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: 8,
  },
  horizontalCard: {
    width: 150,
    marginRight: 10,
    marginBottom: 0,
  },
  urgentCard: {
    borderLeftWidth: 4,
    borderLeftColor: '#F44336',
  },
  name: {
    fontWeight: '600',
  },
  qty: {
    color: '#666',
    marginTop: 2,
  },
  expiry: {
    color: '#FF9800',
    fontWeight: '600',
    marginTop: 6,
  },
  urgentText: {
    color: '#F44336',
  },
});
