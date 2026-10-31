import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { GAUGE_COLORS, type GaugeDefinition } from '@/lib/obd/gauges';

/** A skála 240°-os ív, bal alsó saroktól jobb alsóig (a 0° felfelé mutat). */
const SWEEP = 240;
const START = -SWEEP / 2;
const SIZE = 140;
const CENTER = SIZE / 2;
const RADIUS = 56;
const STROKE = 11;

function polar(angle: number, radius: number) {
  const rad = ((angle - 90) * Math.PI) / 180;
  return { x: CENTER + radius * Math.cos(rad), y: CENTER + radius * Math.sin(rad) };
}

function arc(fromAngle: number, toAngle: number) {
  const a = polar(fromAngle, RADIUS);
  const b = polar(toAngle, RADIUS);
  const large = toAngle - fromAngle > 180 ? 1 : 0;
  return `M ${a.x} ${a.y} A ${RADIUS} ${RADIUS} 0 ${large} 1 ${b.x} ${b.y}`;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

function formatLimit(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function Gauge({
  label,
  value,
  unit,
  decimals,
  gauge,
}: {
  label: string;
  value: number | null | undefined;
  unit: string;
  decimals: number;
  gauge: GaugeDefinition;
}) {
  const theme = useTheme();
  const { min, max, zones } = gauge;
  const toAngle = (v: number) => START + ((clamp(v, min, max) - min) / (max - min)) * SWEEP;
  const needleAngle = value == null ? START : toAngle(value);
  const tip = polar(needleAngle, RADIUS - STROKE);
  const minPos = polar(START, RADIUS - STROKE - 10);
  const maxPos = polar(START + SWEEP, RADIUS - STROKE - 10);

  return (
    <ThemedView type="backgroundElement" style={styles.tile}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <View style={styles.dial}>
        <Svg width={SIZE} height={SIZE * 0.82} viewBox={`0 0 ${SIZE} ${SIZE * 0.82}`}>
          <Path
            d={arc(START, START + SWEEP)}
            stroke={theme.backgroundSelected}
            strokeWidth={STROKE}
            fill="none"
          />
          {zones.map((zone) => (
            <Path
              key={`${zone.from}-${zone.to}`}
              d={arc(toAngle(zone.from), toAngle(zone.to))}
              stroke={GAUGE_COLORS[zone.color]}
              strokeWidth={STROKE}
              fill="none"
            />
          ))}
          <SvgText x={minPos.x + 4} y={minPos.y} fontSize={10} fill={theme.textSecondary} textAnchor="start">
            {formatLimit(min)}
          </SvgText>
          <SvgText x={maxPos.x - 4} y={maxPos.y} fontSize={10} fill={theme.textSecondary} textAnchor="end">
            {formatLimit(max)}
          </SvgText>
          {value != null && (
            <Line
              x1={CENTER}
              y1={CENTER}
              x2={tip.x}
              y2={tip.y}
              stroke={theme.text}
              strokeWidth={3}
              strokeLinecap="round"
            />
          )}
          <Circle cx={CENTER} cy={CENTER} r={6} fill={theme.text} />
        </Svg>
      </View>
      <ThemedText style={styles.value}>
        {value == null ? '–' : value.toFixed(decimals)}
        <ThemedText type="small"> {unit}</ThemedText>
      </ThemedText>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  tile: {
    flexBasis: '47%',
    flexGrow: 1,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.one,
  },
  dial: {
    alignItems: 'center',
  },
  value: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: 600,
    textAlign: 'center',
    marginTop: -Spacing.three,
  },
});
