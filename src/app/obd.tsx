import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  PermissionsAndroid,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { Elm327 } from '@/lib/obd/elm327';
import { AFTERTREATMENT_PIDS, LIVE_PIDS, type PidDefinition } from '@/lib/obd/pids';
import {
  changedZones,
  formatLogCsv,
  formatScan,
  MAX_LOG_ROWS,
  PSA_ECUS,
  readLogRow,
  scanPsaZones,
  type PsaEcu,
  type PsaLogRow,
  type PsaScanResult,
} from '@/lib/obd/psa';

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

function ValueTile({ label, value, unit, decimals }: {
  label: string;
  value: number | null | undefined;
  unit: string;
  decimals: number;
}) {
  return (
    <ThemedView type="backgroundElement" style={styles.tile}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText style={styles.value}>
        {value == null ? '–' : value.toFixed(decimals)}
        <ThemedText type="small"> {unit}</ThemedText>
      </ThemedText>
    </ThemedView>
  );
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
  const [aftertreatmentPids, setAftertreatmentPids] = useState<PidDefinition[]>([]);
  const [scan, setScan] = useState<PsaScanResult | null>(null);
  const [previousScan, setPreviousScan] = useState<PsaScanResult | null>(null);
  const [scanProgress, setScanProgress] = useState<string | null>(null);
  const scanCancelRef = useRef(false);
  const [logRows, setLogRows] = useState<PsaLogRow[]>([]);
  const [logging, setLogging] = useState(false);
  const logStopRef = useRef(false);

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

  const poll = useCallback(async (elm: Elm327, supported: PidDefinition[]) => {
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
      // A szélessávú lambda (34) mellett a régi (24) felesleges.
      const aftertreatment = AFTERTREATMENT_PIDS.filter(
        (p) => elm.isSupported(p.pid) && !(p.pid === '24' && elm.isSupported('34'))
      );
      setPids(supported);
      setAftertreatmentPids(aftertreatment);
      setInfo(`${elm.adapterVersion} · ${elm.protocol}`);
      setStatus('connected');
      poll(elm, [...supported, ...aftertreatment]);
    } catch (e) {
      ObdBluetooth.disconnect();
      setStatus('idle');
      setError(errorMessage(e));
    }
  };

  const scanPsa = async (ecu: PsaEcu) => {
    const elm = elmRef.current;
    if (!elm) return;
    // A gyári olvasás alatt a szabványos lekérdezés szünetel.
    stopPolling();
    scanCancelRef.current = false;
    setScanProgress('Kapcsolódás…');
    try {
      const result = await scanPsaZones(
        elm,
        ecu,
        (done, total) => setScanProgress(`${done} / ${total}`),
        () => scanCancelRef.current
      );
      setPreviousScan(scan?.ecu.id === ecu.id ? scan : null);
      setLogRows([]);
      setScan(result);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setScanProgress(null);
      if (elmRef.current === elm && ObdBluetooth?.isConnected()) {
        poll(elm, [...pids, ...aftertreatmentPids]);
      }
    }
  };

  /** Vezetés közbeni napló: körönként a válaszoló zónák és a szabványos adatok. */
  const startLogging = async () => {
    const elm = elmRef.current;
    if (!elm || !scan?.session) return;
    const allPids = [...pids, ...aftertreatmentPids];
    const zones = scan.zones.map((z) => z.zone);
    // A szabványos lekérdezés helyett ez a ciklus fut, ugyanazzal az azonosítóval áll le.
    const logId = ++pollIdRef.current;
    const isActive = () => pollIdRef.current === logId;
    logStopRef.current = false;
    setLogRows([]);
    setLogging(true);
    try {
      while (isActive()) {
        const row = await readLogRow(elm, scan.ecu, zones, allPids);
        if (!isActive()) break;
        setValues((prev) => ({ ...prev, ...row.values }));
        setLogRows((prev) => [...prev, row].slice(-MAX_LOG_ROWS));
      }
    } catch (e) {
      if (!ObdBluetooth?.isConnected()) {
        setError(errorMessage(e));
        disconnect();
      }
    } finally {
      setLogging(false);
      // Csak a kör végén indulhat újra a szabványos lekérdezés, addig a gyári fejléc él.
      if (logStopRef.current && elmRef.current === elm && ObdBluetooth?.isConnected()) {
        poll(elm, allPids);
      }
    }
  };

  /** A leállítás jelzés; a ciklus a kör végén lép ki. */
  const stopLogging = () => {
    logStopRef.current = true;
    stopPolling();
  };

  const shareLog = () => {
    if (scan) Share.share({ message: formatLogCsv(scan.ecu, logRows, [...pids, ...aftertreatmentPids]) });
  };

  const shareScan = () => {
    if (scan) Share.share({ message: formatScan(scan, previousScan) });
  };

  const changed = scan ? changedZones(scan, previousScan) : new Set<string>();

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
              {pids.map((pid) => (
                <ValueTile key={pid.pid} {...pid} value={values[pid.pid]} />
              ))}
            </ThemedView>

            <ThemedText type="smallBold">Katalizátor és DPF (kísérleti)</ThemedText>
            {aftertreatmentPids.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                Az autó a szabványos csatornán nem ad katalizátor vagy DPF adatot.
              </ThemedText>
            ) : (
              <ThemedView style={styles.grid}>
                {aftertreatmentPids.map((pid) => (
                  <ValueTile key={pid.pid} {...pid} value={values[pid.pid]} />
                ))}
              </ThemedView>
            )}

            <ThemedView type="backgroundElement" style={styles.card}>
              <ThemedText type="smallBold">Gyári adatok (Peugeot / Citroën)</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                A koromtöltöttséget, a regenerálást és az adalékszintet csak a gyári csatornán adja
                ki a vezérlő. Ez végigolvassa és nyersen megmutatja az adatait (csak olvas, semmit
                nem ír a vezérlőbe), kb. 1 perc. Ha regenerálás előtt és után is beolvasod, a
                megváltozott sorok csillagot kapnak. A Megosztás gombbal el tudod küldeni.
              </ThemedText>
              <ThemedView type="backgroundElement" style={styles.row}>
                {PSA_ECUS.map((ecu) => (
                  <Button
                    key={ecu.id}
                    title={ecu.label}
                    onPress={() => scanPsa(ecu)}
                    disabled={scanProgress !== null || dtcBusy || logging}
                  />
                ))}
                {scanProgress !== null && (
                  <>
                    <ActivityIndicator />
                    <ThemedText type="small">{scanProgress}</ThemedText>
                    <Button title="Leállítás" onPress={() => (scanCancelRef.current = true)} />
                  </>
                )}
              </ThemedView>
              {scan && (
                <>
                  <ThemedText type="small" themeColor="textSecondary">
                    {scan.ecu.label}, {scan.time.toLocaleTimeString('hu-HU')}:{' '}
                    {scan.session
                      ? `${scan.zones.length} zóna válaszolt.`
                      : 'a vezérlő nem válaszolt a gyári címen.'}
                  </ThemedText>
                  {scan.zones.map((z) => (
                    <ThemedText key={z.zone} type="code">
                      {changed.has(z.zone) ? '* ' : '  '}
                      {z.zone}: {z.data}
                    </ThemedText>
                  ))}
                  {scan.session && <Button title="Megosztás" onPress={shareScan} />}
                </>
              )}
            </ThemedView>

            {scan?.session && scan.zones.length > 0 && (
              <ThemedView type="backgroundElement" style={styles.card}>
                <ThemedText type="smallBold">Napló vezetés közben</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  Folyamatosan olvassa a fenti zónákat a fordulattal, sebességgel, hőfokokkal együtt.
                  Egy hosszabb út (vagy egy regenerálás) naplójából visszafejthető, melyik zóna mit
                  jelent. Utána a Megosztás gombbal küldd el.
                </ThemedText>
                <ThemedView type="backgroundElement" style={styles.row}>
                  {logging ? (
                    <Button title="Napló leállítása" onPress={stopLogging} />
                  ) : (
                    <Button
                      title="Napló indítása"
                      onPress={startLogging}
                      disabled={scanProgress !== null || dtcBusy}
                    />
                  )}
                  {logging && <ActivityIndicator />}
                  <ThemedText type="small">{logRows.length} sor</ThemedText>
                  {!logging && logRows.length > 0 && (
                    <Button title="Napló megosztása" onPress={shareLog} />
                  )}
                </ThemedView>
              </ThemedView>
            )}

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
                <Button title="Kiolvasás" onPress={readDtcs} disabled={dtcBusy || scanProgress !== null || logging} />
                <Button title="Törlés" onPress={clearDtcs} disabled={dtcBusy || scanProgress !== null || logging} />
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
