import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, Surface, Switch, Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { getPushPreferences, updatePushPreferences } from '../../services/api';
import { isMealLogNotificationSupported } from '../../services/mealLogNotifications';
import { userFacingError } from '../../utils/userFacingError';

export function MarketingPushSection() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const prefs = await getPushPreferences();
      setEnabled(prefs.marketing_enabled);
    } catch (e) {
      setError(userFacingError(e, t('profile.marketingPushLoadError')));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!isMealLogNotificationSupported()) {
      setLoading(false);
      return;
    }
    void load();
  }, [load]);

  const onToggle = async (next: boolean) => {
    setSaving(true);
    setError('');
    const prev = enabled;
    setEnabled(next);
    try {
      const prefs = await updatePushPreferences(next);
      setEnabled(prefs.marketing_enabled);
    } catch (e) {
      setEnabled(prev);
      setError(userFacingError(e, t('profile.marketingPushSaveError')));
    } finally {
      setSaving(false);
    }
  };

  if (!isMealLogNotificationSupported()) {
    return null;
  }

  return (
    <Surface style={styles.section} elevation={1}>
      <Text variant="titleSmall" style={styles.title}>{t('profile.marketingPush')}</Text>
      <Text variant="bodySmall" style={styles.hint}>{t('profile.marketingPushHint')}</Text>
      {loading ? (
        <ActivityIndicator size="small" style={styles.loader} />
      ) : (
        <View style={styles.row}>
          <Text variant="bodyMedium" style={styles.label}>{t('profile.marketingPushToggle')}</Text>
          <Switch value={enabled} onValueChange={(v) => void onToggle(v)} disabled={saving} />
        </View>
      )}
      {error ? <Text variant="bodySmall" style={styles.error}>{error}</Text> : null}
    </Surface>
  );
}

const styles = StyleSheet.create({
  section: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    backgroundColor: '#fff',
  },
  title: {
    fontWeight: '600',
    marginBottom: 4,
  },
  hint: {
    color: '#666',
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: {
    flex: 1,
    paddingRight: 12,
  },
  loader: {
    marginVertical: 8,
  },
  error: {
    color: '#C62828',
    marginTop: 8,
  },
});
