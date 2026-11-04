import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { formatValue, type Param, STATUS_LABELS } from '@/lib/obd/params';
import { useSeries } from '@/lib/obd/session';

import { BAD_COLOR, Chart } from './chart';

/** A háttérgrafikon mindig az utolsó egy percet mutatja. */
export const TILE_WINDOW_MS = 60_000;

export const STATUS_COLORS = {
  identified: '#3c87f7',
  questionable: '#F59E0B',
  unidentified: '#8B8D98',
} as const;

export const WARN_COLOR = BAD_COLOR;

/** Egy paraméter doboza: megnevezés és érték, a háttérben az utolsó perc grafikonja. */
export function ParamTile({ param, value }: { param: Param; value: number | null | undefined }) {
  const series = useSeries(param.id, TILE_WINDOW_MS);
  const now = series.t.length > 0 ? Math.max(Date.now(), series.t[series.t.length - 1]) : Date.now();
  const outside = value != null && param.ok != null && (value < param.ok[0] || value > param.ok[1]);
  const marked = param.status !== 'identified';

  return (
    <Pressable
      onPress={() => router.push({ pathname: '/param/[id]', params: { id: param.id } })}
      style={({ pressed }) => pressed && styles.pressed}>
      <ThemedView
        type="backgroundElement"
        style={[
          styles.tile,
          marked && { borderColor: STATUS_COLORS[param.status], borderLeftWidth: 4 },
          param.status === 'unidentified' && styles.unidentified,
        ]}>
        <Chart
          series={series}
          range={param.range}
          ok={param.ok}
          from={now - TILE_WINDOW_MS}
          to={now}
          subtle
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.labelColumn}>
          <ThemedText type="small" numberOfLines={2}>
            {param.label}
          </ThemedText>
          {marked && (
            <View style={[styles.badge, { backgroundColor: STATUS_COLORS[param.status] }]}>
              <ThemedText type="smallBold" style={styles.badgeText}>
                {param.status === 'questionable' ? '? ' : ''}
                {STATUS_LABELS[param.status]}
              </ThemedText>
            </View>
          )}
        </View>
        <ThemedText style={[styles.value, outside && { color: WARN_COLOR }]} numberOfLines={1}>
          {formatValue(param, value)}
          {param.unit !== '' && param.unit !== 'nyers' && <ThemedText type="small"> {param.unit}</ThemedText>}
        </ThemedText>
      </ThemedView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: 68,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
    overflow: 'hidden',
  },
  unidentified: {
    borderStyle: 'dashed',
    borderWidth: 1,
    borderLeftWidth: 4,
  },
  labelColumn: {
    flex: 1,
    gap: Spacing.one,
    alignItems: 'flex-start',
  },
  badge: {
    paddingHorizontal: Spacing.two,
    borderRadius: Spacing.two,
  },
  badgeText: {
    color: '#ffffff',
    fontSize: 11,
    lineHeight: 16,
  },
  value: {
    fontSize: 26,
    lineHeight: 32,
    fontWeight: 600,
    textAlign: 'right',
  },
  pressed: {
    opacity: 0.6,
  },
});
