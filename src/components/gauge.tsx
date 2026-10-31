import { StyleSheet } from 'react-native';
import Svg, {
  Circle,
  Defs,
  G,
  Line,
  LinearGradient,
  Polygon,
  RadialGradient,
  Rect,
  Stop,
  Text as SvgText,
} from 'react-native-svg';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { GAUGE_COLORS, type GaugeDefinition } from '@/lib/obd/gauges';

/**
 * Klasszikus kerek autós műszer: krómozott perem, fekete számlap, világító skála,
 * piros mutató és alul egy kis LCD kijelző a pontos értékkel.
 * A skála 270°-os, alul van a rés (0° felfelé mutat).
 */
const SWEEP = 270;
const START = -SWEEP / 2;
const C = 100;
const MINOR_PER_MAJOR = 4;

function polar(angle: number, radius: number) {
  const rad = ((angle - 90) * Math.PI) / 180;
  return { x: C + radius * Math.cos(rad), y: C + radius * Math.sin(rad) };
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
  const { min, max, step, caption, zones } = gauge;
  const toAngle = (v: number) => START + ((clamp(v, min, max) - min) / (max - min)) * SWEEP;
  const colorAt = (v: number) => {
    const zone = zones.find((z) => v >= z.from && v <= z.to);
    return GAUGE_COLORS[zone?.color ?? 'green'];
  };

  const ticks: { value: number; major: boolean }[] = [];
  const minorStep = step / MINOR_PER_MAJOR;
  for (let i = 0; min + i * minorStep <= max + 1e-9; i++) {
    ticks.push({ value: min + i * minorStep, major: i % MINOR_PER_MAJOR === 0 });
  }

  const needleAngle = value == null ? START : toAngle(value);
  const tip = polar(needleAngle, 78);
  const tail = polar(needleAngle + 180, 16);
  const left = polar(needleAngle - 90, 3.5);
  const right = polar(needleAngle + 90, 3.5);
  const lcdText = value == null ? '----' : value.toFixed(decimals);

  return (
    <ThemedView type="backgroundElement" style={styles.tile}>
      <ThemedText type="small" themeColor="textSecondary" numberOfLines={2} style={styles.label}>
        {label}
      </ThemedText>
      <Svg viewBox="0 0 200 200" style={styles.dial}>
        <Defs>
          <LinearGradient id="chrome" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#FFFFFF" />
            <Stop offset="0.35" stopColor="#B9BEC5" />
            <Stop offset="0.55" stopColor="#F4F6F8" />
            <Stop offset="1" stopColor="#7D838B" />
          </LinearGradient>
          <RadialGradient id="face" cx="50%" cy="45%" r="55%">
            <Stop offset="0" stopColor="#1C2228" />
            <Stop offset="1" stopColor="#050607" />
          </RadialGradient>
          <LinearGradient id="lcd" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#9AF1FF" />
            <Stop offset="1" stopColor="#36BFE0" />
          </LinearGradient>
          <RadialGradient id="hub" cx="40%" cy="35%" r="70%">
            <Stop offset="0" stopColor="#3A3F45" />
            <Stop offset="1" stopColor="#000000" />
          </RadialGradient>
        </Defs>

        {/* Krómozott perem és számlap */}
        <Circle cx={C} cy={C} r={99} fill="url(#chrome)" />
        <Circle cx={C} cy={C} r={89} fill="#0A0C0E" />
        <Circle cx={C} cy={C} r={87} fill="url(#face)" />

        {/* Osztások: a normál tartomány cián, a figyelmeztető sávok narancs és piros */}
        {ticks.map(({ value: v, major }) => {
          const angle = toAngle(v);
          const outer = polar(angle, 81);
          const inner = polar(angle, major ? 67 : 74);
          return (
            <Line
              key={v}
              x1={outer.x}
              y1={outer.y}
              x2={inner.x}
              y2={inner.y}
              stroke={colorAt(v)}
              strokeWidth={major ? 4 : 2}
              strokeLinecap="round"
            />
          );
        })}
        {ticks
          .filter((t) => t.major)
          .map(({ value: v }) => {
            const pos = polar(toAngle(v), 55);
            return (
              <SvgText
                key={`label-${v}`}
                x={pos.x}
                y={pos.y + 5}
                fontSize={14}
                fontWeight="bold"
                fill={colorAt(v)}
                textAnchor="middle">
                {formatLimit(v)}
              </SvgText>
            );
          })}

        <SvgText x={C} y={72} fontSize={13} fontWeight="bold" fontStyle="italic" fill="#3EE0FF" textAnchor="middle">
          {caption}
        </SvgText>
        <SvgText x={C} y={128} fontSize={12} fontWeight="bold" fill="#3EE0FF" textAnchor="middle">
          {unit}
        </SvgText>

        {/* LCD kijelző */}
        <Rect x={68} y={148} width={64} height={22} rx={2} fill="url(#lcd)" />
        <SvgText
          x={128}
          y={165}
          fontSize={16}
          fontWeight="bold"
          fontFamily="monospace"
          fill="#0B2530"
          textAnchor="end">
          {lcdText}
        </SvgText>

        {/* Mutató és agy */}
        <G>
          <Polygon
            points={`${tail.x},${tail.y} ${left.x},${left.y} ${tip.x},${tip.y} ${right.x},${right.y}`}
            fill="#FF2A1F"
          />
          <Circle cx={C} cy={C} r={14} fill="url(#hub)" stroke="#2A2E33" strokeWidth={1.5} />
        </G>
      </Svg>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  tile: {
    flexBasis: '47%',
    flexGrow: 1,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.two,
    alignItems: 'center',
  },
  label: {
    textAlign: 'center',
  },
  dial: {
    width: '100%',
    maxWidth: 220,
    aspectRatio: 1,
  },
});
