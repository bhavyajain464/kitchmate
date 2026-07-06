import React, { useCallback, useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import {
  Text,
  Surface,
  Button,
  Switch,
  ActivityIndicator,
  Icon,
} from 'react-native-paper';
import { DietNutrientAnalysis } from './DietNutrientAnalysis';
import * as api from '../../services/api';
import { DietAnalysisSettings } from '../../types';
import { useUpgradePaywall } from '../../context/UpgradePaywallContext';
import { showAppError } from '../../utils/alertMessage';

export function MealsHistoryDietTab() {
  const { openUpgrade } = useUpgradePaywall();
  const [dietSettings, setDietSettings] = useState<DietAnalysisSettings | null>(null);
  const [dietLoading, setDietLoading] = useState(true);
  const [dietSaving, setDietSaving] = useState(false);

  const refreshDiet = useCallback(async () => {
    setDietLoading(true);
    try {
      const s = await api.getDietAnalysisSettings();
      setDietSettings(s);
    } catch {
      setDietSettings(null);
    } finally {
      setDietLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshDiet();
  }, [refreshDiet]);

  const toggleDietEmail = async (enabled: boolean) => {
    setDietSaving(true);
    try {
      const s = await api.updateDietAnalysisSettings(enabled);
      setDietSettings(s);
    } catch {
      showAppError('Could not update diet email settings.');
    } finally {
      setDietSaving(false);
    }
  };

  const openDietUpgrade = () => {
    openUpgrade({ source: 'diet_analysis', preferredTier: 'elite', preferredInterval: 'monthly' });
  };

  return (
    <View style={styles.wrap}>
      <Surface style={styles.dietCard} elevation={1}>
        <View style={styles.dietHeader}>
          <Icon source="chart-line" size={28} color="#2E7D32" />
          <View style={styles.dietHeaderText}>
            <Text variant="titleMedium" style={styles.dietTitle}>Diet analysis</Text>
          </View>
        </View>

        {dietLoading ? (
          <ActivityIndicator style={{ marginVertical: 12 }} color="#2E7D32" />
        ) : dietSettings?.eligible ? (
          <>
            {dietSettings.delivery_summary ? (
              <Text variant="bodySmall" style={styles.dietMeta}>{dietSettings.delivery_summary}</Text>
            ) : null}
            {!dietSettings.smtp_configured ? (
              <Text variant="bodySmall" style={styles.warn}>
                Email delivery is not configured on the server yet (SMTP).
              </Text>
            ) : null}
            <View style={styles.switchRow}>
              <Text variant="bodyMedium">Email me my weekly meal summary</Text>
              <Switch
                value={dietSettings.email_enabled}
                onValueChange={(v) => void toggleDietEmail(v)}
                disabled={dietSaving || !dietSettings.smtp_configured}
                color="#2E7D32"
              />
            </View>
          </>
        ) : (
          <>
            <Text variant="bodySmall" style={styles.dietMeta}>
              Upgrade to Elite for AI diet insights and the weekly email digest. Pro covers meal suggestions only.
            </Text>
            <Button
              mode="contained"
              icon="crown"
              onPress={openDietUpgrade}
              style={styles.eliteBtn}
              buttonColor="#2E7D32"
            >
              Upgrade to Elite
            </Button>
          </>
        )}
      </Surface>

      <DietNutrientAnalysis eligible={dietSettings?.eligible} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 24 },
  dietCard: {
    borderRadius: 16,
    padding: 16,
    backgroundColor: '#F1F8E9',
    borderWidth: 1,
    borderColor: '#C8E6C9',
    marginBottom: 16,
  },
  dietHeader: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  dietHeaderText: { flex: 1 },
  dietTitle: { fontWeight: '800', color: '#1A1A1A' },
  dietMeta: { color: '#555', lineHeight: 18, marginBottom: 8 },
  warn: { color: '#E65100', marginBottom: 8 },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  eliteBtn: { marginTop: 8, borderRadius: 12 },
});
