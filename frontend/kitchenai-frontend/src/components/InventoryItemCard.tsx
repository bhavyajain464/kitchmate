import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Card, Text, IconButton } from 'react-native-paper';
import { InventoryItem } from '../types';

interface InventoryItemCardProps {
  item: InventoryItem;
  onPress?: () => void;
  onDelete?: (item: InventoryItem) => void;
}

export function InventoryItemCard({ item, onPress, onDelete }: InventoryItemCardProps) {
  let daysLeft: number | null = null;
  if (item.estimated_expiry) {
    const expiry = new Date(item.estimated_expiry);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    expiry.setHours(0, 0, 0, 0);
    daysLeft = Math.round((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  }

  const isUrgent = daysLeft !== null && daysLeft <= 2;
  const isExpired = daysLeft !== null && daysLeft < 0;

  const expiryLabel = daysLeft === null
    ? null
    : isExpired
      ? `Expired ${Math.abs(daysLeft)} day${Math.abs(daysLeft) !== 1 ? 's' : ''} ago`
      : daysLeft === 0
        ? 'Expires today'
        : daysLeft === 1
          ? '1 day left'
          : `${daysLeft} days left`;

  return (
    <Card style={styles.card} mode="elevated" onPress={onPress}>
      <Card.Content style={styles.content}>
        <View style={styles.row}>
          <View style={styles.info}>
            <Text variant="titleMedium" style={styles.name}>
              {item.canonical_name}
            </Text>
            <Text variant="bodyMedium" style={styles.qty}>
              {item.qty} {item.unit}
            </Text>
            {expiryLabel && (
              <Text variant="bodySmall" style={[
                styles.expiry,
                isExpired && { color: '#F44336' },
                isUrgent && !isExpired && { color: '#FF5722' },
              ]}>
                {expiryLabel}
              </Text>
            )}
          </View>
          {onDelete && (
            <IconButton
              icon="delete-outline"
              iconColor="#F44336"
              size={22}
              onPress={() => onDelete(item)}
              style={styles.deleteBtn}
            />
          )}
        </View>
      </Card.Content>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: 8,
  },
  content: {
    gap: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  info: {
    flex: 1,
    gap: 4,
  },
  name: {
    fontWeight: '600',
  },
  qty: {
    color: '#666',
  },
  expiry: {
    color: '#FF9800',
    fontWeight: '600',
  },
  deleteBtn: {
    margin: 0,
  },
});
