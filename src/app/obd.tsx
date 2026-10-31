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

import { Gauge } from '@/components/gauge';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { Elm327 } from '@/lib/obd/elm327';
import { GAUGES } from '@/lib/obd/gauges';
import { AFTERTREATMENT_PIDS, LIVE_PIDS, type PidDefinition } from '@/lib/obd/pids';
import {
  createLogFile,
  deleteLogFile,
  listLogFiles,
  logCsvHeader,
  logCsvLine,
  type LogTarget,
  readLogRow,
  type SavedLog,
  shareLogFile,
} from '@/lib/obd/log';
import {
  commandKey,
  decodeHit,
  formatNumber,
  formatProbe,
  NEGATIVE_CODES,
  OBDB_COMMANDS,
  OBDB_SIGNAL_COUNT,
  type ObdbProbeResult,
  probeObdb,
} from '@/lib/obd/obdb';
import {
  changedZones,
  formatScan,
  PSA_ECUS,
  scanPsaZones,
  type PsaEcu,
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

/** A mutatós kijelzős értékek előre kerülnek, a többi utánuk. */
const gaugesFirst = (pids: PidDefinition[]) => [
  ...pids.filter((p) => GAUGES[p.pid]),
  ...pids.filter((p) => !GAUGES[p.pid]),
];

function ValueTile({ pid, label, value, unit, decimals }: {
  pid: string;
  label: string;
  value: number | null | undefined;
  unit: string;
  decimals: number;
}) {
  const gauge = GAUGES[pid];
  if (gauge) {
    return <Gauge label={label} value={value} unit={unit} decimals={decimals} gauge={gauge} />;
  }
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
  const [probe, setProbe] = useState<ObdbProbeResult | null>(null);
  const [probeProgress, setProbeProgress] = useState<string | null>(null);
  const probeCancelRef = useRef(false);
  /** A gyári adatok legutóbbi nyers válaszai (kulcs pl. `6A8.22D400`), a kijelzéshez. */
  const [factoryRaw, setFactoryRaw] = useState<Record<string, string>>({});
  const [logCount, setLogCount] = useState(0);
  const [logName, setLogName] = useState<string | null>(null);
  const [savedLogs, setSavedLogs] = useState<SavedLog[]>([]);
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
      setInfo(`VIN: ${elm.vin ?? 'nem olvasható'} · ${elm.adapterVersion} · ${elm.protocol}`);
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

  /** Végigpróbálja az OBDb Peugeot 508 lista összes kérését. */
  const runProbe = async () => {
    const elm = elmRef.current;
    if (!elm) return;
    stopPolling();
    probeCancelRef.current = false;
    setProbeProgress('Kapcsolódás…');
    try {
      const result = await probeObdb(
        elm,
        (done, total) => setProbeProgress(`${done} / ${total}`),
        () => probeCancelRef.current
      );
      setProbe(result);
      setFactoryRaw(
        Object.fromEntries(result.groups.flatMap((g) => g.hits.map((h) => [commandKey(h.command), h.data])))
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setProbeProgress(null);
      if (elmRef.current === elm && ObdBluetooth?.isConnected()) {
        poll(elm, [...pids, ...aftertreatmentPids]);
      }
    }
  };

  /** A napló céljai: a beolvasott zónák és a válaszoló OBDb kérések, vezérlőnként. */
  const logTargets = (): LogTarget[] => {
    const targets = new Map<string, LogTarget>();
    const target = (ecu: PsaEcu) => {
      if (!targets.has(ecu.tx)) targets.set(ecu.tx, { ecu, zones: [], commands: [] });
      return targets.get(ecu.tx)!;
    };
    if (scan?.session && scan.zones.length > 0) {
      target(scan.ecu).zones.push(...scan.zones.map((z) => z.zone));
    }
    for (const group of probe?.groups ?? []) {
      if (group.hits.length === 0) continue;
      const t = target(group.ecu);
      t.commands.push(...group.hits.map((h) => h.command));
      if (group.session === '1003') t.preferredSession = ['1003'];
    }
    return [...targets.values()];
  };

  const refreshSavedLogs = useCallback(async () => {
    if (!ObdBluetooth) return;
    try {
      setSavedLogs(await listLogFiles());
    } catch {
      // Fájlrendszer nélkül (pl. régi build) nincs mentett napló.
    }
  }, []);

  /** Vezetés közbeni napló: körönként a gyári adatok és a szabványos értékek, fájlba. */
  const startLogging = async () => {
    const elm = elmRef.current;
    const targets = logTargets();
    if (!elm || targets.length === 0) return;
    const allPids = [...pids, ...aftertreatmentPids];
    // A szabványos lekérdezés helyett ez a ciklus fut, ugyanazzal az azonosítóval áll le.
    const logId = ++pollIdRef.current;
    const isActive = () => pollIdRef.current === logId;
    logStopRef.current = false;
    setLogCount(0);
    setLogging(true);
    try {
      const startedAt = new Date();
      const file = await createLogFile(logCsvHeader(targets, allPids, elm.vin), elm.vin, startedAt);
      setLogName(file.name);
      let count = 0;
      while (isActive()) {
        const row = await readLogRow(elm, targets, allPids);
        await file.append(logCsvLine(row, startedAt, targets, allPids));
        if (!isActive()) break;
        setValues((prev) => ({ ...prev, ...row.values }));
        setFactoryRaw((prev) => ({ ...prev, ...row.raw }));
        setLogCount(++count);
      }
    } catch (e) {
      setError(errorMessage(e));
      if (!ObdBluetooth?.isConnected()) disconnect();
    } finally {
      setLogging(false);
      refreshSavedLogs();
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

  const shareLog = (log: SavedLog) => {
    shareLogFile(log.uri).catch((e) => setError(errorMessage(e)));
  };

  const removeLog = (log: SavedLog) => {
    Alert.alert('Napló törlése', log.name, [
      { text: 'Mégse', style: 'cancel' },
      {
        text: 'Törlés',
        style: 'destructive',
        onPress: async () => {
          await deleteLogFile(log.uri).catch((e) => setError(errorMessage(e)));
          refreshSavedLogs();
        },
      },
    ]);
  };

  const shareProbe = () => {
    if (probe) Share.share({ message: formatProbe(probe) });
  };

  const shareScan = () => {
    if (scan) Share.share({ message: formatScan(scan, previousScan) });
  };

  const changed = scan ? changedZones(scan, previousScan) : new Set<string>();
  const busy = scanProgress !== null || probeProgress !== null || dtcBusy || logging;
  const targets = status === 'connected' ? logTargets() : [];
  const probeHits = probe?.groups.flatMap((g) => g.hits) ?? [];

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

  const doClearDtcs = async () => {
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
  };

  const clearDtcs = () => {
    // Weben az Alert.alert nem jelenik meg, ott a böngésző saját kérdését használjuk.
    if (Platform.OS === 'web') {
      if (window.confirm('Törlöd a tárolt hibakódokat?')) doClearDtcs();
      return;
    }
    Alert.alert(
      'Hibakódok törlése',
      'Ez törli a tárolt hibakódokat és lekapcsolja a motorhiba lámpát. Csak járó motornál vagy ráadott gyújtásnál, álló autóval csináld.',
      [
        { text: 'Mégse', style: 'cancel' },
        {
          text: 'Törlés',
          style: 'destructive',
          onPress: doClearDtcs,
        },
      ]
    );
  };

  useEffect(() => {
    loadDevices();
    refreshSavedLogs();
    return () => {
      stopPolling();
      ObdBluetooth?.disconnect();
    };
  }, [loadDevices, refreshSavedLogs]);

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

        {Platform.OS === 'web' && (
          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="small">
              Webes előnézet: itt nincs Bluetooth, egy kitalált adapter és autó adatait látod.
              Válaszd az „OBDII (demo)” eszközt.
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
              {Platform.OS === 'android' && (
                <Button
                  title="Bluetooth beállítások"
                  onPress={() => Linking.sendIntent('android.settings.BLUETOOTH_SETTINGS')}
                />
              )}
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
              <ValueTile pid="battery" label="Akkumulátor" value={battery} unit="V" decimals={1} />
              {gaugesFirst(pids).map((pid) => (
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
                {gaugesFirst(aftertreatmentPids).map((pid) => (
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
                    disabled={busy}
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

            <ThemedView type="backgroundElement" style={styles.card}>
              <ThemedText type="smallBold">Ismert gyári adatok (OBDb lista)</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Egy közösségi adatbázis {OBDB_SIGNAL_COUNT} Peugeot 508 gyári adatot ír le névvel és
                mértékegységgel. Nincs autón igazolva, és főleg az újabb motorokhoz készült, ezért ez
                egyszer végigkérdezi mind a {OBDB_COMMANDS.length} kérést, és megjegyzi, melyikre
                válaszol a te autód (csak olvas, 1–5 perc, álló autóval, ráadott gyújtással).
              </ThemedText>
              <ThemedView type="backgroundElement" style={styles.row}>
                <Button title="Próba indítása" onPress={runProbe} disabled={busy} />
                {probeProgress !== null && (
                  <>
                    <ActivityIndicator />
                    <ThemedText type="small">{probeProgress}</ThemedText>
                    <Button title="Leállítás" onPress={() => (probeCancelRef.current = true)} />
                  </>
                )}
              </ThemedView>
              {probe?.groups.map((g) => (
                <ThemedText key={`${g.ecu.tx}${g.sourceSession}`} type="small" themeColor="textSecondary">
                  {g.ecu.label} ({g.ecu.tx}
                  {g.sourceSession ? `, ${g.sourceSession}` : ''}): {g.asked} kérés, {g.hits.length} válasz
                  {Object.entries(g.negative).map(
                    ([code, n]) => `, ${n}× ${NEGATIVE_CODES[code] ?? `elutasítva (${code})`}`
                  )}
                  {g.gaveUp ? ', nem válaszol' : g.silent > 0 ? `, ${g.silent} néma` : ''}
                </ThemedText>
              ))}
              {probeHits.map((hit) => {
                const data = factoryRaw[commandKey(hit.command)] ?? hit.data;
                const decoded = decodeHit(hit.command, data);
                return hit.command.signals.map((signal, i) => (
                  <ThemedText key={signal.id} type="small">
                    {signal.name}:{' '}
                    <ThemedText type="smallBold">
                      {decoded[i] == null ? '–' : formatNumber(decoded[i]!)} {signal.unit}
                    </ThemedText>
                  </ThemedText>
                ));
              })}
              {probe && <Button title="Eredmény megosztása" onPress={shareProbe} />}
            </ThemedView>

            {targets.length > 0 && (
              <ThemedView type="backgroundElement" style={styles.card}>
                <ThemedText type="smallBold">Napló vezetés közben</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  Folyamatosan olvassa a gyári adatokat ({targets
                    .map((t) => `${t.ecu.label}: ${t.zones.length} zóna, ${t.commands.length} ismert kérés`)
                    .join('; ')}
                  ) a fordulattal, sebességgel, hőfokokkal együtt, és mindent egy fájlba ment a
                  telefonon. Egy hosszabb útból (vagy egy regenerálásból) visszafejthető, melyik
                  adat mit jelent.
                </ThemedText>
                <ThemedView type="backgroundElement" style={styles.row}>
                  {logging ? (
                    <Button title="Napló leállítása" onPress={stopLogging} />
                  ) : (
                    <Button title="Napló indítása" onPress={startLogging} disabled={busy} />
                  )}
                  {logging && <ActivityIndicator />}
                  {(logging || logName) && (
                    <ThemedText type="small">
                      {logCount} sor{logName ? ` · ${logName}` : ''}
                    </ThemedText>
                  )}
                </ThemedView>
              </ThemedView>
            )}

            {savedLogs.length > 0 && (
              <ThemedView type="backgroundElement" style={styles.card}>
                <ThemedText type="smallBold">Mentett naplók</ThemedText>
                {savedLogs.map((log) => (
                  <ThemedView key={log.uri} type="backgroundElement" style={styles.row}>
                    <ThemedText type="small" style={styles.logName}>
                      {log.name} ({Math.max(1, Math.round(log.size / 1024))} kB)
                    </ThemedText>
                    <Button title="Megosztás" onPress={() => shareLog(log)} disabled={logging && log.name === logName} />
                    <Button title="Törlés" onPress={() => removeLog(log)} disabled={logging && log.name === logName} />
                  </ThemedView>
                ))}
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
                <Button title="Kiolvasás" onPress={readDtcs} disabled={busy} />
                <Button title="Törlés" onPress={clearDtcs} disabled={busy} />
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
    width: '100%',
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
  logName: {
    flexBasis: '100%',
  },
});
