import { ActivityIndicator, Alert, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, ScreenHeader } from '@/components/obd/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { obd, useObd } from '@/lib/obd/session';

/** Tárolt hibakódok kiolvasása és törlése. Közben az adatgyűjtés pár másodpercre szünetel. */
export default function DtcScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { status, dtcs, busy, error } = useObd();
  const connected = status === 'connected';

  const clear = () => {
    if (Platform.OS === 'web') {
      if (window.confirm('Törlöd a tárolt hibakódokat?')) obd.clearDtcs();
      return;
    }
    Alert.alert(
      'Hibakódok törlése',
      'Ez törli a tárolt hibakódokat és lekapcsolja a motorhiba lámpát. Csak járó motornál vagy ráadott gyújtásnál, álló autóval csináld.',
      [
        { text: 'Mégse', style: 'cancel' },
        { text: 'Törlés', style: 'destructive', onPress: () => obd.clearDtcs() },
      ]
    );
  };

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <ScreenHeader title="Hibakódok" back />
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
          {!connected && (
            <ThemedText type="small" themeColor="textSecondary">
              Előbb csatlakozz az adapterhez a főképernyőn.
            </ThemedText>
          )}
          {error && (
            <ThemedText type="smallBold" style={styles.errorText}>
              {error}
            </ThemedText>
          )}
          <ThemedView type="backgroundElement" style={styles.card}>
            {dtcs === null && (
              <ThemedText type="small" themeColor="textSecondary">
                Még nem olvastad ki.
              </ThemedText>
            )}
            {dtcs?.length === 0 && <ThemedText type="small">Nincs tárolt hibakód.</ThemedText>}
            {dtcs?.map((code) => (
              <ThemedText key={code} type="code">
                {code}
              </ThemedText>
            ))}
            <View style={styles.row}>
              <Button title="Kiolvasás" onPress={() => obd.readDtcs()} disabled={!connected || busy !== null} />
              <Button title="Törlés" onPress={clear} disabled={!connected || busy !== null} />
              {busy && <ActivityIndicator />}
            </View>
            <ThemedText type="small" themeColor="textSecondary">
              Kiolvasás közben az adatgyűjtés (és a rögzítés) pár másodpercre szünetel.
            </ThemedText>
          </ThemedView>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { flexDirection: 'row', justifyContent: 'center', paddingTop: Spacing.two },
  container: { width: '100%', maxWidth: MaxContentWidth, gap: Spacing.three },
  card: { padding: Spacing.three, borderRadius: Spacing.three, gap: Spacing.two },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  errorText: { color: '#E5484D' },
});
