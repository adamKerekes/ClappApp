import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, ScreenHeader } from '@/components/obd/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { deleteLogFile, listLogFiles, type SavedLog, shareLogFile } from '@/lib/obd/log';
import { errorMessage, useObd } from '@/lib/obd/session';

import { ObdBluetooth } from '../../modules/obd-bluetooth';

function sizeText(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} kB`;
}

/** A telefonon tárolt rögzítések: megosztás és törlés, csatlakozás nélkül is. */
export default function SavesScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { recording } = useObd();
  const [logs, setLogs] = useState<SavedLog[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!ObdBluetooth && Platform.OS !== 'web') {
      setLogs([]);
      return;
    }
    try {
      setLogs(await listLogFiles());
    } catch {
      // Fájlrendszer nélkül (pl. régi build) nincs mentés.
      setLogs([]);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  const remove = (log: SavedLog) => {
    const run = async () => {
      await deleteLogFile(log.uri).catch((e) => setError(errorMessage(e)));
      refresh();
    };
    if (Platform.OS === 'web') {
      if (window.confirm(`Törlöd? ${log.name}`)) run();
      return;
    }
    Alert.alert('Mentés törlése', log.name, [
      { text: 'Mégse', style: 'cancel' },
      { text: 'Törlés', style: 'destructive', onPress: run },
    ]);
  };

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <ScreenHeader title="Mentések" back right={<Button title="Frissítés" onPress={refresh} />} />
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
          <ThemedText type="small" themeColor="textSecondary">
            A rögzítések a telefonon vannak, csatlakozás nélkül is megoszthatók (e-mail, Drive, üzenet). A fájl nevében
            az autó szerepel. A gépen a scripts/analyze-log.py elemzi őket.
          </ThemedText>
          {error && (
            <ThemedText type="smallBold" style={styles.errorText}>
              {error}
            </ThemedText>
          )}
          {logs?.length === 0 && (
            <ThemedText type="small" themeColor="textSecondary">
              Még nincs mentett rögzítés.
            </ThemedText>
          )}
          {logs?.map((log) => {
            const active = recording?.uri === log.uri;
            return (
              <ThemedView key={log.uri} type="backgroundElement" style={styles.card}>
                <ThemedText type="small" style={styles.name}>
                  {log.name}
                </ThemedText>
                <View style={styles.row}>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.flex}>
                    {active ? 'rögzítés folyamatban' : sizeText(log.size)}
                  </ThemedText>
                  <Button title="Megosztás" onPress={() => shareLogFile(log.uri).catch((e) => setError(errorMessage(e)))} disabled={active} />
                  <Button title="Törlés" onPress={() => remove(log)} disabled={active} />
                </View>
              </ThemedView>
            );
          })}
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
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  flex: { flex: 1 },
  name: { flexShrink: 1 },
  errorText: { color: '#E5484D' },
});
