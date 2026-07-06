import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import {
  Text,
  Surface,
  Button,
  Chip,
  ActivityIndicator,
  Icon,
} from 'react-native-paper';
import * as api from '../../services/api';
import { UpgradeRequiredError } from '../../services/api';
import type { DietDayReport, DietMicronutrient } from '../../types';
import { useUpgradePaywall } from '../../context/UpgradePaywallContext';
import { showAppError } from '../../utils/alertMessage';
import { userFacingError } from '../../utils/userFacingError';
import { MacroSplitPie } from './MacroSplitPie';

const ACCENT = '#2E7D32';

function dateInIST(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
}

function formatDateLabel(iso: string): string {
  const today = dateInIST(0);
  const yesterday = dateInIST(-1);
  if (iso === today) return 'Today';
  if (iso === yesterday) return 'Yesterday';
  try {
    return new Intl.DateTimeFormat('en-IN', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: 'Asia/Kolkata',
    }).format(new Date(`${iso}T12:00:00`));
  } catch {
    return iso;
  }
}

function macroStatusColor(status: string): string {
  const s = status.toLowerCase();
  if (s === 'low') return '#E65100';
  if (s === 'high') return '#C62828';
  return '#2E7D32';
}

function MacroStat({ label, value, unit }: { label: string; value: number; unit: string }) {
  return (
    <View style={styles.macroStat}>
      <Text variant="labelSmall" style={styles.macroStatLabel}>{label}</Text>
      <Text variant="titleMedium" style={styles.macroStatValue}>
        {Number.isFinite(value) ? Math.round(value * 10) / 10 : '—'}
        <Text variant="labelSmall" style={styles.macroStatUnit}> {unit}</Text>
      </Text>
    </View>
  );
}

function MicroRow({ item }: { item: DietMicronutrient }) {
  const color = macroStatusColor(item.status);
  return (
    <View style={styles.microRow}>
      <View style={styles.microLeft}>
        <Text variant="bodyMedium" style={styles.microName}>{item.name}</Text>
        <Text variant="bodySmall" style={styles.microAmount}>{item.amount}</Text>
      </View>
      <View style={styles.microRight}>
        <View style={[styles.statusPill, { backgroundColor: color + '18' }]}>
          <Text style={[styles.statusPillText, { color }]}>{item.status}</Text>
        </View>
        {item.note?.trim() ? (
          <Text variant="bodySmall" style={styles.microNote} numberOfLines={2}>{item.note}</Text>
        ) : null}
      </View>
    </View>
  );
}

function BulletList({ title, items, icon }: { title: string; items: string[]; icon: string }) {
  if (!items.length) return null;
  return (
    <View style={styles.bulletSection}>
      <View style={styles.bulletHeader}>
        <Icon source={icon} size={18} color={ACCENT} />
        <Text variant="titleSmall" style={styles.bulletTitle}>{title}</Text>
      </View>
      {items.map((item, i) => (
        <View key={i} style={styles.bulletRow}>
          <Text style={styles.bulletDot}>•</Text>
          <Text variant="bodySmall" style={styles.bulletText}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

type Props = {
  eligible?: boolean;
};

export function DietNutrientAnalysis({ eligible }: Props) {
  const { openUpgrade } = useUpgradePaywall();
  const [selectedDate, setSelectedDate] = useState(dateInIST(0));
  const [report, setReport] = useState<DietDayReport | null>(null);
  const [mealCount, setMealCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [needsUpgrade, setNeedsUpgrade] = useState(false);

  const dateOptions = useMemo(
    () => Array.from({ length: 7 }, (_, i) => dateInIST(-i)),
    [],
  );

  const datePicker = (
    <View style={styles.dateRow}>
      {dateOptions.map((d) => (
        <Chip
          key={d}
          selected={selectedDate === d}
          onPress={() => setSelectedDate(d)}
          style={selectedDate === d ? styles.dateChipOn : styles.dateChip}
          textStyle={selectedDate === d ? styles.dateChipTextOn : styles.dateChipText}
        >
          {formatDateLabel(d)}
        </Chip>
      ))}
    </View>
  );

  const loadReport = useCallback(async (dateISO: string) => {
    if (!eligible) {
      setNeedsUpgrade(true);
      return;
    }
    setLoading(true);
    setNeedsUpgrade(false);
    try {
      const res = await api.getDietDayReport(dateISO);
      setMealCount(res.entries?.length ?? 0);
      setReport(res.report ?? null);
    } catch (err) {
      setReport(null);
      setMealCount(0);
      if (err instanceof UpgradeRequiredError) {
        setNeedsUpgrade(true);
      } else {
        showAppError(userFacingError(err, 'Could not load nutrient analysis.'));
      }
    } finally {
      setLoading(false);
    }
  }, [eligible]);

  useEffect(() => {
    if (eligible) {
      void loadReport(selectedDate);
    }
  }, [eligible, selectedDate, loadReport]);

  const openDietUpgrade = () => {
    openUpgrade({ source: 'diet_analysis', preferredTier: 'elite', preferredInterval: 'monthly' });
  };

  if (!eligible || needsUpgrade) {
    return (
      <Surface style={styles.card} elevation={1}>
        <Button mode="contained" icon="crown" onPress={openDietUpgrade} buttonColor={ACCENT} style={styles.eliteBtn}>
          Upgrade to Elite
        </Button>
      </Surface>
    );
  }

  return (
    <View style={styles.wrap}>
      {datePicker}

      <Surface style={styles.card} elevation={1}>
        {loading ? (
        <ActivityIndicator color={ACCENT} style={styles.loader} />
      ) : mealCount === 0 ? (
        <Text variant="bodySmall" style={styles.empty}>
          No meals logged for {formatDateLabel(selectedDate).toLowerCase()}. Log meals on the Meal planning tab to see analysis here.
        </Text>
      ) : !report ? (
        <Text variant="bodySmall" style={styles.empty}>
          Could not generate analysis. Try again in a moment.
        </Text>
      ) : (
        <>
          {report.balance_score > 0 ? (
            <View style={styles.scoreRow}>
              <Text variant="labelMedium" style={styles.scoreLabel}>Balance score</Text>
              <Text variant="titleMedium" style={styles.scoreValue}>{report.balance_score}/100</Text>
            </View>
          ) : null}

          <Text variant="labelLarge" style={[styles.sectionTitle, report.balance_score > 0 ? undefined : styles.firstSectionTitle]}>
            Macro split
          </Text>
          <MacroSplitPie
            protein={report.macro_split_pct.protein}
            carbs={report.macro_split_pct.carbs}
            fat={report.macro_split_pct.fat}
          />

          <Text variant="labelLarge" style={styles.sectionTitle}>Daily totals</Text>
          <View style={styles.macroGrid}>
            <MacroStat label="Calories" value={report.totals.calories_kcal} unit="kcal" />
            <MacroStat label="Protein" value={report.totals.protein_g} unit="g" />
            <MacroStat label="Carbs" value={report.totals.carbs_g} unit="g" />
            <MacroStat label="Fat" value={report.totals.fat_g} unit="g" />
            <MacroStat label="Fiber" value={report.totals.fiber_g} unit="g" />
            <MacroStat label="Sugar" value={report.totals.sugar_g} unit="g" />
          </View>
          <Text variant="bodySmall" style={styles.sodium}>
            Sodium: {Math.round(report.totals.sodium_mg)} mg
          </Text>

          {report.meals.length > 0 ? (
            <>
              <Text variant="labelLarge" style={styles.sectionTitle}>Per meal</Text>
              {report.meals.map((meal, i) => (
                <View key={`${meal.name}-${i}`} style={styles.mealRow}>
                  <View style={styles.mealLeft}>
                    <Text variant="bodyMedium" style={styles.mealName}>{meal.name}</Text>
                    {meal.slot ? (
                      <Text variant="labelSmall" style={styles.mealSlot}>{meal.slot}</Text>
                    ) : null}
                  </View>
                  <View style={styles.mealRight}>
                    <Text variant="labelMedium" style={styles.mealKcal}>
                      {Math.round(meal.calories_kcal)} kcal
                    </Text>
                    <Text variant="labelSmall" style={styles.mealMacros}>
                      P {Math.round(meal.protein_g)}g · C {Math.round(meal.carbs_g)}g · F {Math.round(meal.fat_g)}g
                    </Text>
                  </View>
                </View>
              ))}
            </>
          ) : null}

          {report.micronutrients.length > 0 ? (
            <>
              <Text variant="labelLarge" style={styles.sectionTitle}>Micronutrients</Text>
              {report.micronutrients.map((m, i) => (
                <MicroRow key={`${m.name}-${i}`} item={m} />
              ))}
            </>
          ) : null}

          <BulletList title="Highlights" items={report.highlights} icon="thumb-up-outline" />
          <BulletList title="Suggestions for tomorrow" items={report.suggestions} icon="lightbulb-outline" />

          {report.disclaimer?.trim() ? (
            <Text variant="labelSmall" style={styles.disclaimer}>{report.disclaimer}</Text>
          ) : null}
        </>
      )}
      </Surface>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 16 },
  card: {
    borderRadius: 16,
    padding: 16,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E8F5E9',
  },
  eliteBtn: { borderRadius: 12 },
  dateRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  dateChip: { backgroundColor: '#F5F5F5' },
  dateChipOn: { backgroundColor: '#E8F5E9' },
  dateChipText: { color: '#666' },
  dateChipTextOn: { color: ACCENT, fontWeight: '700' },
  loader: { marginVertical: 24 },
  empty: { color: '#666', lineHeight: 20, textAlign: 'center', marginVertical: 16 },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E8F5E9',
  },
  scoreLabel: { color: '#666' },
  scoreValue: { fontWeight: '700', color: ACCENT },
  sectionTitle: { fontWeight: '700', color: '#1A1A1A', marginTop: 14, marginBottom: 8 },
  firstSectionTitle: { marginTop: 0 },
  macroGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  macroStat: {
    width: '30%',
    minWidth: 96,
    backgroundColor: '#F9FBF9',
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: '#E8F5E9',
  },
  macroStatLabel: { color: '#888' },
  macroStatValue: { fontWeight: '700', color: '#1A1A1A', marginTop: 2 },
  macroStatUnit: { color: '#888', fontWeight: '400' },
  sodium: { color: '#666', marginTop: 8 },
  mealRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#EEE',
  },
  mealLeft: { flex: 1 },
  mealName: { fontWeight: '600', color: '#222' },
  mealSlot: { color: '#888', marginTop: 2, textTransform: 'capitalize' },
  mealRight: { alignItems: 'flex-end' },
  mealKcal: { fontWeight: '700', color: ACCENT },
  mealMacros: { color: '#888', marginTop: 2 },
  microRow: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F0F0F0',
  },
  microLeft: { width: 110 },
  microName: { fontWeight: '600', color: '#222' },
  microAmount: { color: '#888', marginTop: 2 },
  microRight: { flex: 1 },
  statusPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'capitalize',
    lineHeight: 14,
  },
  microNote: { color: '#666', marginTop: 4, lineHeight: 18 },
  bulletSection: { marginTop: 14 },
  bulletHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  bulletTitle: { fontWeight: '700', color: '#1A1A1A' },
  bulletRow: { flexDirection: 'row', gap: 8, marginBottom: 4, paddingRight: 4 },
  bulletDot: { color: ACCENT, lineHeight: 20 },
  bulletText: { flex: 1, color: '#444', lineHeight: 20 },
  disclaimer: { color: '#999', marginTop: 16, lineHeight: 16, fontStyle: 'italic' },
});
