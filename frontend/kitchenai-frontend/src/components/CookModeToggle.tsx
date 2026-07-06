import React from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Switch, Text } from 'react-native-paper';
import type { CookScreenMode } from '../navigation/cookParams';

type Props = {
  value: CookScreenMode;
  onChange: (mode: CookScreenMode) => void;
};

export function CookModeToggle({ value, onChange }: Props) {
  const { t } = useTranslation();
  const cooking = value === 'cooking';

  return (
    <View style={styles.row}>
      <Text
        variant="labelLarge"
        style={[styles.label, cooking ? styles.labelOn : styles.labelOff]}
      >
        {t('cook.cookingLabel')}
      </Text>
      <Switch
        value={cooking}
        onValueChange={(next) => onChange(next ? 'cooking' : 'cook')}
        color="#2E7D32"
        accessibilityLabel="Toggle cooking mode"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  label: {
    fontWeight: '700',
  },
  labelOff: {
    color: '#BDBDBD',
  },
  labelOn: {
    color: '#2E7D32',
  },
});
