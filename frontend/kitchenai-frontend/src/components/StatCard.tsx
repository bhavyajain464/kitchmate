import React from 'react';
import { StyleSheet } from 'react-native';
import { Card, Text } from 'react-native-paper';

interface StatCardProps {
  value: number | string;
  label: string;
  color?: string;
}

export function StatCard({ value, label, color = '#4CAF50' }: StatCardProps) {
  return (
    <Card style={styles.card} mode="elevated">
      <Card.Content style={styles.content}>
        <Text variant="headlineMedium" style={[styles.value, { color }]}>
          {value}
        </Text>
        <Text variant="labelSmall" style={styles.label}>
          {label}
        </Text>
      </Card.Content>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    marginHorizontal: 4,
  },
  content: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  value: {
    fontWeight: 'bold',
  },
  label: {
    color: '#666',
    marginTop: 4,
    textAlign: 'center',
  },
});
