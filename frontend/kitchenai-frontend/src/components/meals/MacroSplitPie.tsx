import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import Svg, { G, Path } from 'react-native-svg';

const SIZE = 120;
const RADIUS = SIZE / 2 - 4;
const CENTER = SIZE / 2;

const SLICES = [
  { key: 'protein', label: 'Protein', color: '#5C6BC0' },
  { key: 'carbs', label: 'Carbs', color: '#FFA726' },
  { key: 'fat', label: 'Fat', color: '#66BB6A' },
] as const;

function polarToCartesian(angleDeg: number) {
  const angleRad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: CENTER + RADIUS * Math.cos(angleRad),
    y: CENTER + RADIUS * Math.sin(angleRad),
  };
}

function describeSlice(startAngle: number, endAngle: number) {
  if (endAngle - startAngle >= 359.99) {
    return `M ${CENTER} ${CENTER - RADIUS} A ${RADIUS} ${RADIUS} 0 1 1 ${CENTER - 0.01} ${CENTER - RADIUS} Z`;
  }
  const start = polarToCartesian(endAngle);
  const end = polarToCartesian(startAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${CENTER} ${CENTER} L ${start.x} ${start.y} A ${RADIUS} ${RADIUS} 0 ${largeArc} 0 ${end.x} ${end.y} Z`;
}

type Props = {
  protein: number;
  carbs: number;
  fat: number;
};

export function MacroSplitPie({ protein, carbs, fat }: Props) {
  const slices = useMemo(() => {
    const raw = [
      { ...SLICES[0], value: Math.max(protein, 0) },
      { ...SLICES[1], value: Math.max(carbs, 0) },
      { ...SLICES[2], value: Math.max(fat, 0) },
    ];
    const total = raw.reduce((sum, s) => sum + s.value, 0) || 1;
    let cursor = 0;
    return raw.map((s) => {
      const sweep = (s.value / total) * 360;
      const start = cursor;
      const end = cursor + sweep;
      cursor = end;
      return { ...s, pct: Math.round((s.value / total) * 100), start, end };
    });
  }, [protein, carbs, fat]);

  return (
    <View style={styles.wrap}>
      <View style={styles.splitBar}>
        {slices
          .filter((slice) => slice.pct > 0)
          .map((slice) => (
            <View
              key={slice.key}
              style={[styles.splitBarSegment, { flex: slice.pct, backgroundColor: slice.color }]}
            />
          ))}
      </View>

      <View style={styles.legend}>
        {slices.map((slice) => (
          <View key={slice.key} style={styles.legendItem}>
            <View style={[styles.swatch, { backgroundColor: slice.color }]} />
            <Text variant="labelSmall" style={styles.legendLabel}>
              {slice.label}
            </Text>
            <Text variant="labelSmall" style={styles.legendPct}>
              {slice.pct}%
            </Text>
          </View>
        ))}
      </View>

      <View style={styles.pieWrap}>
        <Svg width={SIZE} height={SIZE}>
          <G>
            {slices
              .filter((slice) => slice.end - slice.start > 0.1)
              .map((slice) => (
                <Path
                  key={slice.key}
                  d={describeSlice(slice.start, slice.end)}
                  fill={slice.color}
                />
              ))}
          </G>
        </Svg>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 12,
    paddingVertical: 4,
  },
  splitBar: {
    flexDirection: 'row',
    height: 10,
    borderRadius: 5,
    overflow: 'hidden',
    backgroundColor: '#F0F0F0',
  },
  splitBarSegment: {
    minWidth: 4,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  swatch: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendLabel: {
    color: '#555',
  },
  legendPct: {
    fontWeight: '700',
    color: '#1A1A1A',
  },
  pieWrap: {
    alignItems: 'center',
  },
});
