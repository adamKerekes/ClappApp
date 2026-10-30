import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  PermissionsAndroid,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { Elm327 } from '@/lib/obd/elm327';
import { LIVE_PIDS } from '@/lib/obd/pids';

import { ObdBluetooth, type PairedDevice } from '../../modules/obd-bluetooth';

type Status = 'idle' | 'connecting' | 'connected';

type LiveValues = Record<string, number | null>;

async function requestBluetoothPermission(): Promise<boolean> {
  if (Platform.OS !== 'android' || Platform.Version < 31) return true;
  const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT);
  return result === PermissionsAndroid.RESULTS.GRANTED;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function Button({
  title,
  onPress,
  disabled,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [(pressed || disabled) && styles.pressed]}>
      <ThemedView type="backgroundSelected" style={styles.button}>
        <ThemedText type="smallBold">{title}</ThemedText>
      </ThemedView>
    </Pressable>
  );
}

export default function ObdScreen() {
  const safeAreaInsets = useSafeAreaInsets();
  const theme = useTheme();

  const [status, setStatus] = useState<Status>('idle');
  const [devices, setDevices] = useState<PairedDevice[]>([]);
  const [deviceName, setDeviceName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState('');
  const [values, setValues] = useState<LiveValues>({});
  const [battery, setBattery] = useState<number | null>(null);
  const [dtcs, setDtcs] = useState<string[] | null>(null);
  const [dtcBusy, setDtcBusy] = useState(false);
  const [pids, setPids] = useState(LIVE_PIDS);

  const elmRef = useRef<Elm327 | null>(null);
  // Minden kapcsolódás új azonosítót kap, így a régi lekérdező ciklus biztosan leáll.
  const pollIdRef = useRef(0);

  const loadDevices = useCallback(async () => {
    setError(null);
    if (!ObdBluetooth) return;
    try {
      if (!(await requestBluetoothPermission())) {
        setError('Engedélyezd a „Közeli eszközök” jogosultságot az alkalmazás beállításaiban.');
        return;
      }
      if (!ObdBluetooth.isEnabled()) {
        setError('Kapcsold be a Bluetooth-t.');
        return;
      }
      const paired = await ObdBluetooth.getPairedDevices();
      // Az OBD adapterek nevében általában szerepel az "OBD" vagy "ELM", ezeket tesszük előre.
      const isObd = (d: PairedDevice) => /obd|elm|vlink|vgate|konnwei/i.test(d.name);
      setDevices([...paired.filter(isObd), ...paired.filter((d) => !isObd(d))]);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  const stopPolling = () => {
    pollIdRef.current++;
  };

  const disconnect = useCallback(() => {
    stopPolling();
    elmRef.current = null;
    ObdBluetooth?.disconnect();
    setStatus('idle');
  }, []);

  const poll = useCallback(async (elm: Elm327, supported: typeof LIVE_PIDS) => {
    const pollId = ++pollIdRef.current;
    const isActive = () => pollIdRef.current === pollId;
    let round = 0;
    while (isActive()) {
      for (const pid of supported) {
        if (!isActive()) return;
        try {
          const value = await elm.readPid(pid);
          setValues((prev) => ({ ...prev, [pid.pid]: value }));
        } catch (e) {
          if (!ObdBluetooth?.isConnected()) {
            setError(errorMessage(e));
            disconnect();
            return;
          }
        }
      }
      // A feszültség lassan változik, elég ritkábban lekérdezni.
      if (round % 5 === 0) {
        const voltage = await elm.readBatteryVoltage().catch(() => null);
        if (isActive()) setBattery(voltage);
      }
      round++;
    }
  }, [disconnect]);

  const connect = async (device: PairedDevice) => {
    if (!ObdBluetooth) return;
    setError(null);
    setStatus('connecting');
    setDeviceName(device.name);
    setValues({});
    setDtcs(null);
    setBattery(null);
    try {
      setInfo('Csatlakozás az adapterhez…');
      await ObdBluetooth.connect(device.address);
      const elm = new Elm327();
      setInfo('Kapcsolódás az autóhoz (akár 10 mp)…');
      await elm.initialize();
      elmRef.current = elm;
      const supported = LIVE_PIDS.filter((p) => elm.isSupported(p.pid));
      setPids(supported);
      setInfo(`${elm.adapterVersion} · ${elm.protocol}`);
      setStatus('connected');
      poll(elm, supported);
    } catch (e) {
      ObdBluetooth.disconnect();
      setStatus('idle');
      setError(errorMessage(e));
    }
  };

  const readDtcs = async () => {
    const elm = elmRef.current;
    if (!elm) return;
    setDtcBusy(true);
    try {
      setDtcs(await elm.readDtcs());
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setDtcBusy(false);
    }
  };

  const clearDtcs = () => {
    Alert.alert(
      'Hibakódok törlése',
      'Ez törli a tárolt hibakódokat és lekapcsolja a motorhiba lámpát. Csak járó motornál vagy ráadott gyújtásnál, álló autóval csináld.',
      [
        { text: 'Mégse', style: 'cancel' },
        {
          text: 'Törlés',
          style: 'destructive',
          onPress: async () => {
            const elm = elmRef.current;
            if (!elm) return;
            setDtcBusy(true);
            try {
              await elm.clearDtcs();
              setDtcs(await elm.readDtcs());
            } catch (e) {
              setError(errorMessage(e));
            } finally {
              setDtcBusy(false);
            }
          },
        },
      ]
    );
  };

  useEffect(() => {
    loadDevices();
    return () => {
      stopPolling();
      ObdBluetooth?.disconnect();
    };
  }, [loadDevices]);

  const contentStyle = {
    paddingTop: safeAreaInsets.top + Spacing.four,
    paddingBottom: safeAreaInsets.bottom + BottomTabInset + Spacing.three,
    paddingLeft: safeAreaInsets.left + Spacing.four,
    paddingRight: safeAreaInsets.right + Spacing.four,
  };

  return (
    <ScrollView
      style={[styles.scrollView, { backgroundColor: theme.background }]}
      contentContainerStyle={[styles.contentContainer, contentStyle]}>
      <ThemedView style={styles.container}>
        <ThemedText type="subtitle">OBD</ThemedText>

        {!ObdBluetooth && (
          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="small">
              Az OBD funkció csak Androidon, a Clapp development buildjében működik. Expo Go-ban és
              weben nem érhető el.
            </ThemedText>
          </ThemedView>
        )}

        {error && (
          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="smallBold" style={styles.errorText}>
              {error}
            </ThemedText>
          </ThemedView>
        )}

        {ObdBluetooth && status === 'idle' && (
          <>
            <ThemedText type="small" themeColor="textSecondary">
              Dugd be az adaptert az autó OBD csatlakozójába, add rá a gyújtást, majd párosítsd a
              telefon Bluetooth beállításaiban (a PIN általában 1234 vagy 0000). Utána válaszd ki
              lent.
            </ThemedText>
            <ThemedView style={styles.row}>
              <Button title="Lista frissítése" onPress={loadDevices} />
              <Button
                title="Bluetooth beállítások"
                onPress={() => Linking.sendIntent('android.settings.BLUETOOTH_SETTINGS')}
              />
            </ThemedView>

            <ThemedText type="smallBold">Párosított eszközök</ThemedText>
            {devices.length === 0 && (
              <ThemedText type="small" themeColor="textSecondary">
                Nincs párosított eszköz.
              </ThemedText>
            )}
            {devices.map((device) => (
              <Pressable
                key={device.address}
                onPress={() => connect(device)}
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
            <ThemedText type="small">{info}</ThemedText>
          </ThemedView>
        )}

        {status === 'connected' && (
          <>
            <ThemedView type="backgroundElement" style={styles.card}>
              <ThemedText type="smallBold">{deviceName}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {info}
              </ThemedText>
              <Button title="Leválasztás" onPress={disconnect} />
            </ThemedView>

            <ThemedView style={styles.grid}>
              <ThemedView type="backgroundElement" style={styles.tile}>
                <ThemedText type="small" themeColor="textSecondary">
                  Akkumulátor
                </ThemedText>
                <ThemedText style={styles.value}>
                  {battery == null ? '–' : battery.toFixed(1)}
                  <ThemedText type="small"> V</ThemedText>
                </ThemedText>
              </ThemedView>
              {pids.map((pid) => {
                const value = values[pid.pid];
                return (
                  <ThemedView key={pid.pid} type="backgroundElement" style={styles.tile}>
                    <ThemedText type="small" themeColor="textSecondary">
                      {pid.label}
                    </ThemedText>
                    <ThemedText style={styles.value}>
                      {value == null ? '–' : value.toFixed(pid.decimals)}
                      <ThemedText type="small"> {pid.unit}</ThemedText>
                    </ThemedText>
                  </ThemedView>
                );
              })}
            </ThemedView>

            <ThemedView type="backgroundElement" style={styles.card}>
              <ThemedText type="smallBold">Hibakódok</ThemedText>
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
              <ThemedView type="backgroundElement" style={styles.row}>
                <Button title="Kiolvasás" onPress={readDtcs} disabled={dtcBusy} />
                <Button title="Törlés" onPress={clearDtcs} disabled={dtcBusy} />
                {dtcBusy && <ActivityIndicator />}
              </ThemedView>
            </ThemedView>
          </>
        )}
      </ThemedView>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  contentContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  container: {
    maxWidth: MaxContentWidth,
    flexGrow: 1,
    gap: Spacing.three,
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
  button: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.five,
  },
  pressed: {
    opacity: 0.6,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  tile: {
    flexBasis: '47%',
    flexGrow: 1,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.one,
  },
  value: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: 600,
  },
  errorText: {
    color: '#E5484D',
  },
});
