import { useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Chart, chartRange } from '@/components/obd/chart';
import { STATUS_COLORS, WARN_COLOR } from '@/components/obd/param-tile';
import { ScreenHeader } from '@/components/obd/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { CAR_IDS, CARS } from '@/lib/obd/cars';
import { formatValue, PARAM_BY_ID, sourceText, STATUS_LABELS, STATUS_TEXT } from '@/lib/obd/params';
import { useObd, useSeries } from '@/lib/obd/session';

function duration(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

function Section({ title, children }: { title: string; children: string }) {
  return (
    <View style={styles.section}>
      <ThemedText type="smallBold">{title}</ThemedText>
      <ThemedText type="small">{children}</ThemedText>
    </View>
  );
}

/** Egy paraméter részletes nézete: a teljes futás grafikonja és a leírás. */
export default function ParamDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const param = PARAM_BY_ID[id ?? ''];
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const snap = useObd();
  const series = useSeries(param?.id ?? '', null);

  if (!param) {
    return (
      <View style={[styles.screen, { backgroundColor: theme.background }]}>
        <ScreenHeader title="Ismeretlen paraméter" back />
      </View>
    );
  }

  const value = snap.values[param.id];
  const now = Date.now();
  const from = snap.startedAt ?? (series.t[0] ?? now);
  const to = Math.max(now, series.t[series.t.length - 1] ?? now);
  const [min, max] = chartRange(series, param.range);

  let dataMin: number | null = null;
  let dataMax: number | null = null;
  let sum = 0;
  for (const v of series.v) {
    dataMin = dataMin == null ? v : Math.min(dataMin, v);
    dataMax = dataMax == null ? v : Math.max(dataMax, v);
    sum += v;
  }
  const avg = series.v.length > 0 ? sum / series.v.length : null;
  const outside = value != null && param.ok != null && (value < param.ok[0] || value > param.ok[1]);
  const unit = param.unit === 'nyers' ? '' : param.unit;
  const axis = (v: number) => (param.format ? param.format(v) : v.toFixed(Math.abs(max - min) < 10 ? param.decimals || 1 : 0));

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <ScreenHeader title={param.label} back />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingBottom: insets.bottom + Spacing.four,
            paddingLeft: insets.left + Spacing.three,
            paddingRight: insets.right + Spacing.three,
          },
        ]}>
        <View style={styles.container}>
          <ThemedView type="backgroundElement" style={styles.card}>
            <View style={styles.valueRow}>
              <ThemedText style={[styles.value, outside && { color: WARN_COLOR }]}>
                {formatValue(param, value)}
                {unit !== '' && <ThemedText type="small"> {unit}</ThemedText>}
              </ThemedText>
              <View style={[styles.badge, { backgroundColor: STATUS_COLORS[param.status] }]}>
                <ThemedText type="smallBold" style={styles.badgeText}>
                  {STATUS_LABELS[param.status]}
                </ThemedText>
              </View>
            </View>

            <View style={styles.chartRow}>
              <View style={styles.yAxis}>
                <ThemedText type="small" themeColor="textSecondary">
                  {axis(max)}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {axis(min)}
                </ThemedText>
              </View>
              <Chart series={series} range={param.range} ok={param.ok} from={from} to={to} style={styles.chart} />
            </View>
            <View style={styles.xAxis}>
              <ThemedText type="small" themeColor="textSecondary">
                {new Date(from).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' })}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                teljes futás: {duration(to - from)}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                most
              </ThemedText>
            </View>

            <View style={styles.stats}>
              {[
                ['Min.', dataMin],
                ['Átlag', avg],
                ['Max.', dataMax],
              ].map(([label, v]) => (
                <View key={label as string} style={styles.stat}>
                  <ThemedText type="small" themeColor="textSecondary">
                    {label as string}
                  </ThemedText>
                  <ThemedText type="smallBold">
                    {formatValue(param, v as number | null)} {unit}
                  </ThemedText>
                </View>
              ))}
              <View style={styles.stat}>
                <ThemedText type="small" themeColor="textSecondary">
                  Minták
                </ThemedText>
                <ThemedText type="smallBold">{series.v.length}</ThemedText>
              </View>
            </View>
            {param.ok && (
              <ThemedText type="small" themeColor="textSecondary">
                Zöld sáv: normál tartomány ({formatValue(param, param.ok[0])}–{formatValue(param, param.ok[1])} {unit})
              </ThemedText>
            )}
          </ThemedView>

          <ThemedView type="backgroundElement" style={styles.card}>
            <Section title="Mi ez?">{param.description}</Section>
            <Section title="Optimális érték">{param.optimal}</Section>
            {snap.car ? (
              <Section title={`Ezen az autón (${CARS[snap.car].label})`}>{param.cars[snap.car]}</Section>
            ) : (
              CAR_IDS.map((carId) => (
                <Section key={carId} title={CARS[carId].label}>
                  {param.cars[carId]}
                </Section>
              ))
            )}
          </ThemedView>

          <ThemedView type="backgroundElement" style={styles.card}>
            <Section title="Azonosítás">{STATUS_TEXT[param.status]}</Section>
            <Section title="Forrás">{sourceText(param)}</Section>
          </ThemedView>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingTop: Spacing.two,
  },
  container: {
    width: '100%',
    maxWidth: MaxContentWidth,
    gap: Spacing.three,
  },
  card: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.three,
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  value: {
    fontSize: 40,
    lineHeight: 48,
    fontWeight: 600,
  },
  badge: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
    borderRadius: Spacing.two,
  },
  badgeText: {
    color: '#ffffff',
  },
  chartRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    height: 220,
  },
  yAxis: {
    justifyContent: 'space-between',
  },
  chart: {
    flex: 1,
  },
  xAxis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: -Spacing.two,
  },
  stats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.three,
  },
  stat: {
    minWidth: 70,
  },
  section: {
    gap: Spacing.one,
  },
});
