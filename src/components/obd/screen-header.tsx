import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { CARS } from '@/lib/obd/cars';
import { obd, useObd } from '@/lib/obd/session';

export const RECORD_COLOR = '#E5484D';

export function Button({
  title,
  onPress,
  disabled,
  tone,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  /** `record`: piros (rögzítés), `primary`: kiemelt. */
  tone?: 'record' | 'primary';
}) {
  const colored = tone === 'record' ? RECORD_COLOR : tone === 'primary' ? '#3c87f7' : undefined;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [(pressed || disabled) && styles.pressed]}>
      <ThemedView type="backgroundSelected" style={[styles.button, colored && { backgroundColor: colored }]}>
        <ThemedText type="smallBold" style={colored && styles.lightText}>
          {title}
        </ThemedText>
      </ThemedView>
    </Pressable>
  );
}

function elapsed(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/**
 * Minden képernyő teteje: cím (vissza gombbal vagy menüvel), alatta mindig a rögzítés
 * indítása / leállítása. Nem görög el a tartalommal.
 */
export function ScreenHeader({ title, back, right }: { title: string; back?: boolean; right?: ReactNode }) {
  const insets = useSafeAreaInsets();
  const { status, car, recording, busy } = useObd();

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/obd'));

  let statusText: string;
  if (recording) {
    statusText = `Rögzítés · ${elapsed(Date.now() - recording.startedAt)} · ${recording.rows} sor`;
  } else if (status === 'connected' && car) {
    statusText = `${CARS[car].label} · csatlakozva`;
  } else if (status === 'connected') {
    statusText = 'Csatlakozva · válaszd ki az autót';
  } else if (status === 'connecting') {
    statusText = 'Csatlakozás…';
  } else {
    statusText = 'Nincs kapcsolat';
  }

  return (
    <ThemedView
      style={[
        styles.header,
        { paddingTop: insets.top + Spacing.two, paddingLeft: insets.left + Spacing.three, paddingRight: insets.right + Spacing.three },
      ]}>
      <View style={styles.inner}>
        <View style={styles.titleRow}>
          {back && (
            <Pressable onPress={goBack} hitSlop={12} style={({ pressed }) => pressed && styles.pressed}>
              <ThemedText type="subtitle" style={styles.backArrow}>
                ‹
              </ThemedText>
            </Pressable>
          )}
          <ThemedText type="smallBold" style={styles.title} numberOfLines={1}>
            {title}
          </ThemedText>
          {right}
        </View>
        <ThemedView type="backgroundElement" style={[styles.recordBar, recording && styles.recordBarActive]}>
          {recording && <View style={styles.dot} />}
          <ThemedText type="small" style={styles.statusText} numberOfLines={1}>
            {statusText}
          </ThemedText>
          {recording ? (
            <Button title="■ Leállítás" tone="record" onPress={() => obd.stopRecording()} />
          ) : (
            <Button
              title="● Rögzítés"
              tone="record"
              onPress={() => obd.startRecording()}
              disabled={status !== 'connected' || !car || busy !== null}
            />
          )}
        </ThemedView>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingBottom: Spacing.two,
    alignItems: 'center',
  },
  inner: {
    width: '100%',
    maxWidth: MaxContentWidth,
    gap: Spacing.two,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: 36,
  },
  backArrow: {
    lineHeight: 36,
    paddingRight: Spacing.one,
  },
  title: {
    flex: 1,
    fontSize: 20,
    lineHeight: 28,
  },
  recordBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    paddingLeft: Spacing.three,
    paddingRight: Spacing.two,
    borderRadius: Spacing.three,
  },
  recordBarActive: {
    borderWidth: 1,
    borderColor: RECORD_COLOR,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: RECORD_COLOR,
  },
  statusText: {
    flex: 1,
  },
  button: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.five,
  },
  lightText: {
    color: '#ffffff',
  },
  pressed: {
    opacity: 0.5,
  },
});
