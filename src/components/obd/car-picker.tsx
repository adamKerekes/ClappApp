import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { CAR_IDS, CARS } from '@/lib/obd/cars';
import { obd, useObd } from '@/lib/obd/session';

import { Button } from './screen-header';

/**
 * Teljes képernyős autóválasztó, csatlakozás után. A választás után eltűnik; ettől függ,
 * hogy az app hogyan olvassa és értelmezi a gyári adatokat.
 */
export function CarPicker() {
  const insets = useSafeAreaInsets();
  const { status, car, detectedCar, deviceName } = useObd();
  if (status !== 'connected' || car) return null;

  return (
    <ThemedView
      style={[
        StyleSheet.absoluteFill,
        styles.overlay,
        {
          paddingTop: insets.top + Spacing.five,
          paddingBottom: insets.bottom + Spacing.four,
          paddingLeft: insets.left + Spacing.three,
          paddingRight: insets.right + Spacing.three,
        },
      ]}>
      <View style={styles.inner}>
        <View style={styles.heading}>
          <ThemedText type="subtitle">Melyik autó?</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Csatlakozva: {deviceName}. A választás alapján olvassa a gyári adatokat, és ehhez az autóhoz értelmezi az
            értékeket.
          </ThemedText>
        </View>
        {CAR_IDS.map((id) => {
          const detected = detectedCar === id;
          return (
            <Pressable key={id} onPress={() => obd.selectCar(id)} style={({ pressed }) => [styles.flex, pressed && styles.pressed]}>
              <ThemedView type="backgroundElement" style={[styles.carButton, detected && styles.detected]}>
                <ThemedText type="subtitle" style={styles.carName}>
                  {CARS[id].label}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {CARS[id].note}
                </ThemedText>
                {detected && (
                  <ThemedText type="smallBold" style={styles.detectedText}>
                    A motorvezérlő szoftvere alapján ez az autó
                  </ThemedText>
                )}
              </ThemedView>
            </Pressable>
          );
        })}
        <View style={styles.footer}>
          <Button title="Leválasztás" onPress={() => obd.disconnect()} />
        </View>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  overlay: {
    zIndex: 10,
    alignItems: 'center',
  },
  inner: {
    flex: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
    gap: Spacing.three,
  },
  heading: {
    gap: Spacing.two,
    marginBottom: Spacing.two,
  },
  flex: {
    flex: 1,
  },
  carButton: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.four,
    borderRadius: Spacing.four,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  carName: {
    textAlign: 'center',
  },
  detected: {
    borderColor: '#30A46C',
  },
  detectedText: {
    color: '#30A46C',
    textAlign: 'center',
  },
  footer: {
    alignItems: 'center',
  },
  pressed: {
    opacity: 0.6,
  },
});
