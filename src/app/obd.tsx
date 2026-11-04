import { router } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CarPicker } from '@/components/obd/car-picker';
import { ParamTile, STATUS_COLORS } from '@/components/obd/param-tile';
import { Button, ScreenHeader } from '@/components/obd/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { CARS } from '@/lib/obd/cars';
import { STATUS_LABELS, STATUS_ORDER } from '@/lib/obd/params';
import { obd, paramList, useObd } from '@/lib/obd/session';

import { ObdBluetooth } from '../../modules/obd-bluetooth';

const SECTION_HINTS = {
  identified: 'Autón igazolt vagy szabványos OBD értékek.',
  questionable: 'A jelentésük valószínű, de még nincs igazolva.',
  unidentified: 'Változó gyári adatok ismeretlen jelentéssel, nyers értékkel.',
} as const;

export default function ObdScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const snap = useObd();
  const { status, devices, error, car, detectedCar, factory, recording, busy } = snap;

  useEffect(() => {
    if (obd.getSnapshot().status === 'idle') obd.loadDevices();
  }, []);

  const params = paramList(snap.paramIds);

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <ScreenHeader
        title="Clapp OBD"
        right={
          <View style={styles.menu}>
            <Button title="Mentések" onPress={() => router.push('/saves')} />
            <Button title="Hibakódok" onPress={() => router.push('/dtc')} />
          </View>
        }
      />
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
          {!ObdBluetooth && (
            <ThemedView type="backgroundElement" style={styles.card}>
              <ThemedText type="small">
                Az OBD funkció csak Androidon, a Clapp telepített appjában működik. Expo Go-ban és weben nem érhető el.
              </ThemedText>
            </ThemedView>
          )}

          {Platform.OS === 'web' && (
            <ThemedView type="backgroundElement" style={styles.card}>
              <ThemedText type="small">
                Webes előnézet: itt nincs Bluetooth, egy kitalált adapter és autó adatait látod. Válaszd az „OBDII
                (demo)” eszközt.
              </ThemedText>
            </ThemedView>
          )}

          {error && (
            <Pressable onPress={() => obd.clearError()}>
              <ThemedView type="backgroundElement" style={styles.card}>
                <ThemedText type="smallBold" style={styles.errorText}>
                  {error}
                </ThemedText>
              </ThemedView>
            </Pressable>
          )}

          {ObdBluetooth && status === 'idle' && (
            <>
              <ThemedText type="small" themeColor="textSecondary">
                Dugd be az adaptert az autó OBD csatlakozójába, add rá a gyújtást, majd párosítsd a telefon Bluetooth
                beállításaiban (a PIN általában 1234 vagy 0000). Utána válaszd ki lent.
              </ThemedText>
              <View style={styles.row}>
                <Button title="Lista frissítése" onPress={() => obd.loadDevices()} />
                {Platform.OS === 'android' && (
                  <Button
                    title="Bluetooth beállítások"
                    onPress={() => Linking.sendIntent('android.settings.BLUETOOTH_SETTINGS')}
                  />
                )}
              </View>

              <ThemedText type="smallBold">Párosított eszközök</ThemedText>
              {devices.length === 0 && (
                <ThemedText type="small" themeColor="textSecondary">
                  Nincs párosított eszköz.
                </ThemedText>
              )}
              {devices.map((device) => (
                <Pressable
                  key={device.address}
                  onPress={() => obd.connect(device)}
                  style={({ pressed }) => pressed && styles.pressed}>
                  <ThemedView type="backgroundElement" style={styles.card}>
                    <ThemedText>{device.name}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {device.address}
                    </ThemedText>
                  </ThemedView>
                </Pressable>
              ))}
            </>
          )}

          {status === 'connecting' && (
            <ThemedView type="backgroundElement" style={[styles.card, styles.row]}>
              <ActivityIndicator />
              <ThemedText type="small">{snap.info}</ThemedText>
            </ThemedView>
          )}

          {status === 'connected' && (
            <>
              <ThemedView type="backgroundElement" style={styles.card}>
                <View style={styles.row}>
                  <View style={styles.flex}>
                    <ThemedText type="smallBold">{snap.deviceName}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {snap.info}
                    </ThemedText>
                  </View>
                  <Button title="Leválasztás" onPress={() => obd.disconnect()} />
                </View>
                {car && (
                  <View style={styles.row}>
                    <ThemedText type="smallBold" style={styles.flex}>
                      {CARS[car].label}
                    </ThemedText>
                    <Button title="Autó váltása" onPress={() => obd.clearCar()} disabled={recording !== null} />
                  </View>
                )}
                {busy && (
                  <View style={styles.row}>
                    <ActivityIndicator />
                    <ThemedText type="small">{busy}</ThemedText>
                  </View>
                )}
              </ThemedView>

              {car && detectedCar && detectedCar !== car && (
                <ThemedText type="small" style={styles.warnText}>
                  A motorvezérlő szoftvere alapján ez inkább a(z) {CARS[detectedCar].label}.
                </ThemedText>
              )}
              {car && factory === 'unavailable' && (
                <ThemedText type="small" style={styles.warnText}>
                  A motorvezérlő gyári adatai nem érhetők el, csak a szabványos értékek látszanak és rögzülnek.
                </ThemedText>
              )}

              {STATUS_ORDER.map((statusKey) => {
                const group = params.filter((p) => p.status === statusKey);
                if (group.length === 0) return null;
                return (
                  <View key={statusKey} style={styles.section}>
                    <View style={styles.sectionTitle}>
                      <View style={[styles.sectionDot, { backgroundColor: STATUS_COLORS[statusKey] }]} />
                      <ThemedText type="smallBold">
                        {STATUS_LABELS[statusKey]} paraméterek ({group.length})
                      </ThemedText>
                    </View>
                    <ThemedText type="small" themeColor="textSecondary">
                      {SECTION_HINTS[statusKey]}
                    </ThemedText>
                    {group.map((param) => (
                      <ParamTile key={param.id} param={param} value={snap.values[param.id]} />
                    ))}
                  </View>
                );
              })}
              {car && factory === 'pending' && (
                <View style={styles.row}>
                  <ActivityIndicator />
                  <ThemedText type="small" themeColor="textSecondary">
                    Gyári adatok olvasása…
                  </ThemedText>
                </View>
              )}
            </>
          )}
        </View>
      </ScrollView>
      <CarPicker />
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
  menu: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  card: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Spacing.two,
  },
  flex: {
    flex: 1,
  },
  section: {
    gap: Spacing.two,
  },
  sectionTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  sectionDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  pressed: {
    opacity: 0.6,
  },
  errorText: {
    color: '#E5484D',
  },
  warnText: {
    color: '#F59E0B',
  },
});
