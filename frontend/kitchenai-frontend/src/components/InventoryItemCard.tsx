import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Card, Text, IconButton } from 'react-native-paper';
import { InventoryItem } from '../types';

interface InventoryItemCardProps {
  item: InventoryItem;
  onPress?: () => void;
  onExpire?: (item: InventoryItem) => void;
  onEditExpiry?: (item: InventoryItem) => void;
}

export function InventoryItemCard({ item, onPress, onExpire, onEditExpiry }: InventoryItemCardProps) {
  let daysLeft: number | null = null;
  if (item.estimated_expiry) {
    const expiry = new Date(item.estimated_expiry);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    expiry.setHours(0, 0, 0, 0);
    daysLeft = Math.round((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  }

  const isUrgent = daysLeft !== null && daysLeft <= 2;

  const expiryLabel = daysLeft === null
    ? null
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
                isUrgent && { color: '#FF5722' },
              ]}>
                {expiryLabel}
              </Text>
            )}
          </View>
          <View style={styles.actions}>
            {onEditExpiry && (
              <IconButton
                icon="calendar-edit"
                iconColor="#2196F3"
                size={22}
                onPress={() => onEditExpiry(item)}
                style={styles.actionBtn}
              />
            )}
            {onExpire && (
              <IconButton
                icon="clock-remove-outline"
                iconColor="#FF9800"
                size={22}
                onPress={() => onExpire(item)}
                style={styles.actionBtn}
              />
            )}
          </View>
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
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionBtn: {
    margin: 0,
  },
});
