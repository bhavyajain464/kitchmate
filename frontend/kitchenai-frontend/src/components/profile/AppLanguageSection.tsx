import React from 'react';
import { StyleSheet, View, Pressable } from 'react-native';
import { Text, Surface } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { useLocale } from '../../context/LocaleContext';

export function AppLanguageSection() {
  const { t } = useTranslation();
  const { language, setLanguage, languageOptions } = useLocale();

  return (
    <Surface style={styles.section} elevation={1}>
      <Text variant="titleSmall" style={styles.title}>
        {t('profile.appLanguage')}
      </Text>
      <Text variant="bodySmall" style={styles.hint}>
        {t('profile.appLanguageHint')}
      </Text>
      <View style={styles.chips}>
        {languageOptions.map((opt) => {
          const selected = language === opt.code;
          return (
            <Pressable
              key={opt.code}
              onPress={() => void setLanguage(opt.code)}
              style={({ pressed }) => [
                styles.chip,
                selected && styles.chipOn,
                pressed && { opacity: 0.9 },
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected }}
            >
              <Text style={[styles.chipText, selected && styles.chipTextOn]}>{opt.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </Surface>
  );
}

const styles = StyleSheet.create({
  section: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    backgroundColor: '#fff',
  },
  title: {
    fontWeight: '700',
    color: '#1B1B1B',
    marginBottom: 4,
  },
  hint: {
    color: '#666',
    marginBottom: 12,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#C8E6C9',
    backgroundColor: '#F1F8F4',
  },
  chipOn: {
    backgroundColor: '#2E7D32',
    borderColor: '#2E7D32',
  },
  chipText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2E7D32',
  },
  chipTextOn: {
    color: '#fff',
  },
});
