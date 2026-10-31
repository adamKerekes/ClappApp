import { StyleSheet } from 'react-native';
import Svg, {
  Circle,
  Defs,
  G,
  Line,
  LinearGradient,
  Path,
  Polygon,
  RadialGradient,
  Rect,
  Stop,
  Text as SvgText,
  TSpan,
} from 'react-native-svg';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { GAUGE_COLORS, type GaugeDefinition, type GaugeIcon } from '@/lib/obd/gauges';

/**
 * Klasszikus autós műszer: vastag fényes krómgyűrű, fekete számlap üveges csillogással,
 * fehér osztások (a figyelmeztető tartomány narancs, a veszélyes piros), piros mutató
 * fényes fekete aggyal, két csavarfej és alul cián LCD a pontos értékkel és mértékegységgel.
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

/** Kis fehér ikonok a számlapra, egy 20×20-as területre rajzolva. */
function Icon({ icon, x, y }: { icon: GaugeIcon; x: number; y: number }) {
  const white = '#F2F2F2';
  return (
    <G transform={`translate(${x - 10} ${y - 10})`}>
      {icon === 'battery' && (
        <>
          <Rect x={1} y={5} width={18} height={12} rx={1.5} fill="none" stroke={white} strokeWidth={1.8} />
          <Rect x={4} y={2.5} width={3} height={2.5} fill={white} />
          <Rect x={13} y={2.5} width={3} height={2.5} fill={white} />
          <Line x1={3.5} y1={11} x2={7.5} y2={11} stroke={white} strokeWidth={1.6} />
          <Line x1={12.5} y1={11} x2={16.5} y2={11} stroke={white} strokeWidth={1.6} />
          <Line x1={14.5} y1={9} x2={14.5} y2={13} stroke={white} strokeWidth={1.6} />
        </>
      )}
      {(icon === 'coolant' || icon === 'thermo') && (
        <>
          <Rect x={8} y={0} width={4} height={12} rx={2} fill="none" stroke={white} strokeWidth={1.6} />
          <Circle cx={10} cy={13.5} r={3.2} fill={white} />
          <Line x1={12} y1={3} x2={15} y2={3} stroke={white} strokeWidth={1.4} />
          <Line x1={12} y1={6.5} x2={15} y2={6.5} stroke={white} strokeWidth={1.4} />
        </>
      )}
      {icon === 'coolant' && (
        <Path d="M0 19 q2.5 -2 5 0 t5 0 t5 0 t5 0" fill="none" stroke={white} strokeWidth={1.5} />
      )}
    </G>
  );
}

function Screw({ x, y }: { x: number; y: number }) {
  return (
    <G>
      <Circle cx={x} cy={y} r={3.6} fill="url(#screw)" stroke="#111" strokeWidth={0.6} />
      <Line x1={x - 2.2} y1={y} x2={x + 2.2} y2={y} stroke="#1A1A1A" strokeWidth={0.9} />
      <Line x1={x} y1={y - 2.2} x2={x} y2={y + 2.2} stroke="#1A1A1A" strokeWidth={0.9} />
    </G>
  );
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
  const { min, max, step, caption, icon, zones } = gauge;
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
  const tip = polar(needleAngle, 80);
  const tail = polar(needleAngle + 180, 22);
  const left = polar(needleAngle - 90, 2.8);
  const right = polar(needleAngle + 90, 2.8);
  const tailLeft = polar(needleAngle + 180 - 12, 20);
  const tailRight = polar(needleAngle + 180 + 12, 20);
  const lcdText = value == null ? '----' : value.toFixed(decimals);

  return (
    <ThemedView type="backgroundElement" style={styles.tile}>
      <ThemedText type="small" themeColor="textSecondary" numberOfLines={2} style={styles.label}>
        {label}
      </ThemedText>
      <Svg viewBox="0 0 200 200" style={styles.dial}>
        <Defs>
          {/* Vastag, fényes króm: világos és sötét sávok váltakoznak */}
          <LinearGradient id="chrome" x1="0.15" y1="0" x2="0.85" y2="1">
            <Stop offset="0" stopColor="#FDFDFB" />
            <Stop offset="0.18" stopColor="#8C847A" />
            <Stop offset="0.38" stopColor="#E9E6E0" />
            <Stop offset="0.55" stopColor="#5E574F" />
            <Stop offset="0.75" stopColor="#D8D3CC" />
            <Stop offset="1" stopColor="#4A443E" />
          </LinearGradient>
          <LinearGradient id="chromeInner" x1="0.85" y1="1" x2="0.15" y2="0">
            <Stop offset="0" stopColor="#F5F3EF" />
            <Stop offset="0.5" stopColor="#6E675F" />
            <Stop offset="1" stopColor="#2B2723" />
          </LinearGradient>
          <RadialGradient id="face" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor="#151515" />
            <Stop offset="0.85" stopColor="#050505" />
            <Stop offset="1" stopColor="#000000" />
          </RadialGradient>
          <LinearGradient id="glass" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0.16" />
            <Stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
          </LinearGradient>
          <RadialGradient id="hub" cx="35%" cy="30%" r="75%">
            <Stop offset="0" stopColor="#8A8A8A" />
            <Stop offset="0.35" stopColor="#1E1E1E" />
            <Stop offset="1" stopColor="#000000" />
          </RadialGradient>
          <RadialGradient id="screw" cx="35%" cy="30%" r="80%">
            <Stop offset="0" stopColor="#9A9A9A" />
            <Stop offset="1" stopColor="#3A3A3A" />
          </RadialGradient>
        </Defs>

        {/* Krómgyűrű és számlap */}
        <Circle cx={C} cy={C} r={99} fill="url(#chrome)" />
        <Circle cx={C} cy={C} r={90} fill="url(#chromeInner)" />
        <Circle cx={C} cy={C} r={86} fill="#000" />
        <Circle cx={C} cy={C} r={85} fill="url(#face)" />

        {/* Osztások és számok */}
        {ticks.map(({ value: v, major }) => {
          const angle = toAngle(v);
          const outer = polar(angle, 82);
          const inner = polar(angle, major ? 68 : 75);
          return (
            <Line
              key={v}
              x1={outer.x}
              y1={outer.y}
              x2={inner.x}
              y2={inner.y}
              stroke={colorAt(v)}
              strokeWidth={major ? 4.5 : 1.8}
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
                y={pos.y + 5.5}
                fontSize={15}
                fontWeight="bold"
                fontFamily="Arial, Helvetica, sans-serif"
                fill={colorAt(v)}
                textAnchor="middle">
                {formatLimit(v)}
              </SvgText>
            );
          })}

        {icon ? (
          <Icon icon={icon} x={C} y={68} />
        ) : (
          <SvgText
            x={C}
            y={73}
            fontSize={12}
            fontWeight="bold"
            fontFamily="Arial, Helvetica, sans-serif"
            fill="#F2F2F2"
            textAnchor="middle">
            {caption}
          </SvgText>
        )}

        <Screw x={68} y={116} />
        <Screw x={132} y={116} />

        {/* LCD kijelző mértékegységgel */}
        <Rect x={64} y={150} width={72} height={20} fill="#3DF2F2" stroke="#0E3B3B" strokeWidth={1.2} />
        <SvgText
          x={132}
          y={165}
          fontSize={14}
          fontWeight="bold"
          fontFamily="monospace"
          fill="#0A1414"
          textAnchor="end">
          {lcdText}
          <TSpan fontSize={11} dx={2}>
            {unit}
          </TSpan>
        </SvgText>

        {/* Mutató ellensúllyal és fényes agy */}
        <Polygon
          points={`${tail.x},${tail.y} ${left.x},${left.y} ${tip.x},${tip.y} ${right.x},${right.y}`}
          fill="#E3323C"
        />
        <Polygon points={`${tailLeft.x},${tailLeft.y} ${C},${C} ${tailRight.x},${tailRight.y}`} fill="#B8222B" />
        <Circle cx={C} cy={C} r={10} fill="url(#hub)" />

        {/* Üveges csillogás a felső részen */}
        <Path
          d={`M ${C - 78} ${C - 8} A 80 80 0 0 1 ${C + 78} ${C - 8} Q ${C} ${C - 40} ${C - 78} ${C - 8} Z`}
          fill="url(#glass)"
        />
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
