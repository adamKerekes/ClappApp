import { useMemo, useSyncExternalStore } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';

import { ObdBluetooth, type PairedDevice } from '../../../modules/obd-bluetooth';

import { type CarId, CARS, detectCar } from './cars';
import { Elm327 } from './elm327';
import { createLogFile, deleteLogFile, type LogFile, writeTextFile } from './log';
import { PARAMS, type Param, type ZoneId } from './params';
import { AFTERTREATMENT_PIDS, LIVE_PIDS, type PidDefinition } from './pids';
import {
  closeSession,
  DTC_STATE_LABELS,
  openSession,
  type PsaDtc,
  type PsaEcu,
  readPsaDtcs,
  readZone,
  readZoneChecked,
} from './psa';

/**
 * Az OBD kapcsolat és az adatgyűjtés egy helyen, a képernyőktől függetlenül.
 *
 * Csatlakozás után egyetlen ciklus olvas folyamatosan: ez frissíti az élő értékeket és a
 * grafikonok előzményét, és ha fut a rögzítés, ugyanez a ciklus írja a sorokat a fájlba.
 * Így a képernyők között lapozva (részletes nézet, mentések) és háttérben is megy tovább.
 *
 * Sűrűbb mintavétel: a gyorsan változó értékeket (fordulat, sebesség, légtömeg) minden
 * körben, a lassúakat (hőfokok, feszültség) felváltva, körönként egyet kérdezzük. Ha a gyári
 * zónák jönnek, a szabványos terhelés, szívócsőnyomás, fojtás és lambda is a lassúak közé
 * kerül, mert a 21CA / 21CB ugyanezt (pontosabban) minden körben adja. A gyári munkamenetet
 * nem zárjuk le körönként, csak a fejlécet és a válaszcímet váltjuk. Egy kör így kb.
 * 1,3–1,6 mp (2026-11-06 előtt 1,5–2,1 mp, eredetileg 5–6).
 */

export type Status = 'idle' | 'connecting' | 'connected';
export type FactoryState = 'off' | 'pending' | 'ok' | 'unavailable';

export type Recording = {
  name: string;
  uri: string;
  rows: number;
  startedAt: number;
};

export type Snapshot = {
  status: Status;
  devices: PairedDevice[];
  deviceName: string;
  info: string;
  error: string | null;
  /** A kiválasztott autó; ettől függ a gyári adatok olvasása és értelmezése. */
  car: CarId | null;
  /** A 21 82 zóna alapján felismert autó (javaslat a választáshoz). */
  detectedCar: CarId | null;
  factory: FactoryState;
  /** A kijelzett paraméterek (amiket az autó ad). */
  paramIds: string[];
  values: Record<string, number | null>;
  /** Az adatgyűjtés kezdete (a teljes futás grafikonjához). */
  startedAt: number | null;
  recording: Recording | null;
  /** Hibakód-olvasás és hasonló kizárólagos művelet fut (a gyűjtés addig szünetel). */
  busy: string | null;
  /** Szabványos OBD hibakódok (Mode 03). */
  dtcs: string[] | null;
  /** A motorvezérlő (6A8) gyári hibakódjai; `null`, ha még nem olvastuk, vagy nem válaszolt. */
  psaDtcs: PsaDtc[] | null;
  /** Az utolsó kiolvasás ideje és mentett fájlja. */
  dtcTime: number | null;
  dtcFile: { name: string; uri: string } | null;
  version: number;
};

export type Series = { t: number[]; v: number[] };

const ENGINE: PsaEcu = { id: 'engine', label: 'Motorvezérlő', tx: '6A8', rx: '688' };

/** Minden körben olvasott zónák, és a felváltva olvasottak (körönként egy). */
const ZONES_EVERY_ROUND: ZoneId[] = ['CA', 'CB'];
const ZONES_ROTATING: ZoneId[] = ['C7', 'C9', 'CC', 'CD', 'DC'];
const ALL_ZONES: ZoneId[] = [...ZONES_EVERY_ROUND, ...ZONES_ROTATING];

/** Gyorsan változó szabványos értékek: minden körben. */
const FAST_PARAMS = new Set(['rpm', 'speed', 'load', 'map', 'maf', 'throttle', 'lambda']);
/** Gyári zónákkal elég ennyi: a többit a 21CA / 21CB minden körben adja. */
const FAST_PARAMS_WITH_ZONES = new Set(['rpm', 'speed', 'maf']);
/** Ennyi lassú értéket olvasunk körönként (felváltva). */
const SLOW_PER_ROUND = 1;

/** Ennyi ms-onként frissül legfeljebb a képernyő. */
const EMIT_INTERVAL_MS = 300;
/** Paraméterenként ennyi pontot tartunk meg (1 mp-es mintánál kb. 14 óra). */
const HISTORY_LIMIT = 50000;

const ALL_PIDS = [...LIVE_PIDS, ...AFTERTREATMENT_PIDS];
const pidByCode = (code: string) => ALL_PIDS.find((p) => p.pid === code);

export function errorMessage(error: unknown): string {
  let message = error instanceof Error ? error.message : String(error);
  // A natív modul hibáinak angol előtagja („Call to function … has been rejected. → Caused by:”).
  message = message.replace(/^[\s\S]*Caused by:\s*/, '');
  if (/nem válaszolt időben|timed? ?out/i.test(message)) {
    return 'Az autó nem válaszol. Rá van adva a gyújtás, és az adapter be van dugva? Ha igen, válaszd le, és csatlakozz újra.';
  }
  if (/read failed|socket|broken pipe|connection/i.test(message)) {
    return 'Megszakadt a Bluetooth kapcsolat az adapterrel. Ellenőrizd, hogy be van-e dugva, és csatlakozz újra.';
  }
  return message;
}

async function requestBluetoothPermission(): Promise<boolean> {
  if (Platform.OS !== 'android' || Platform.Version < 31) return true;
  const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT);
  return result === PermissionsAndroid.RESULTS.GRANTED;
}

/** Android 13+: a háttérben futó rögzítés értesítéséhez. Ha nem engedi, a rögzítés akkor is megy. */
function requestNotificationPermission() {
  if (Platform.OS !== 'android' || Platform.Version < 33) return;
  PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS).catch(() => {});
}

const csvLabel = (text: string) => text.replace(/[;\n]/g, ',').replace(/–/g, '-');

type RecordingState = Recording & {
  file: LogFile;
  columns: string[];
  /** Melyik oszlopba mi kerül: paraméter vagy nyers zóna. */
  cells: ({ kind: 'param'; id: string; decimals: number } | { kind: 'zone'; zone: ZoneId } | { kind: 'dtc' })[];
  writes: Promise<void>;
};

type Row = {
  time: number;
  values: Record<string, number | null>;
  raw: Partial<Record<ZoneId, string>>;
  /** Hibakód-kiolvasás eredménye (csak abban a sorban, amikor volt). */
  dtc?: string;
};

class ObdSession {
  private snap: Snapshot = {
    status: 'idle',
    devices: [],
    deviceName: '',
    info: '',
    error: null,
    car: null,
    detectedCar: null,
    factory: 'off',
    paramIds: [],
    values: {},
    startedAt: null,
    recording: null,
    busy: null,
    dtcs: null,
    psaDtcs: null,
    dtcTime: null,
    dtcFile: null,
    version: 0,
  };
  private listeners = new Set<() => void>();
  private lastEmit = 0;

  private elm: Elm327 | null = null;
  private loopId = 0;
  /** A paraméterhez tartozó szabványos PID (amit az autó ténylegesen ismer). */
  private pids = new Map<string, PidDefinition>();
  private round = 0;
  private slowIndex = 0;
  /** Nyitott gyári munkamenet nyitó kérése (pl. `81`), vagy `null`. */
  private factorySession: string | null = null;
  private factoryFails = 0;
  /** Zónánként a leghosszabb hiánytalan válasz bájtszáma; ennél rövidebbet nem számolunk át. */
  private zoneLengths: Partial<Record<ZoneId, number>> = {};

  private history = new Map<string, Series>();
  private seriesCache = new Map<string, { version: number; data: Series }>();

  private recordingState: RecordingState | null = null;

  /** Kizárólagos művelet (pl. hibakód) alatt a ciklus megáll a kör végén. */
  private pauseCount = 0;
  private parked = false;
  private onParked: (() => void) | null = null;
  private wake: (() => void) | null = null;

  // --- Feliratkozás --------------------------------------------------------------------

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => this.snap;

  private set(patch: Partial<Snapshot>) {
    this.snap = { ...this.snap, ...patch, version: this.snap.version + 1 };
    this.lastEmit = Date.now();
    this.listeners.forEach((l) => l());
  }

  /** Élő értékeknél ritkítva frissít, hogy a képernyő ne akadjon. Időzítőt nem használ, háttérben is megy. */
  private maybeEmit(force = false) {
    if (!force && Date.now() - this.lastEmit < EMIT_INTERVAL_MS) return;
    this.set({ values: { ...this.values } });
  }

  private values: Record<string, number | null> = {};

  // --- Eszközök és kapcsolat ---------------------------------------------------------------

  async loadDevices() {
    this.set({ error: null });
    if (!ObdBluetooth) return;
    try {
      if (!(await requestBluetoothPermission())) {
        this.set({ error: 'Engedélyezd a „Közeli eszközök” jogosultságot az alkalmazás beállításaiban.' });
        return;
      }
      if (!ObdBluetooth.isEnabled()) {
        this.set({ error: 'Kapcsold be a Bluetooth-t.' });
        return;
      }
      const paired = await ObdBluetooth.getPairedDevices();
      // Az OBD adapterek nevében általában szerepel az "OBD" vagy "ELM", ezeket tesszük előre.
      const isObd = (d: PairedDevice) => /obd|elm|vlink|vgate|konnwei/i.test(d.name);
      this.set({ devices: [...paired.filter(isObd), ...paired.filter((d) => !isObd(d))] });
    } catch (e) {
      this.set({ error: errorMessage(e) });
    }
  }

  async connect(device: PairedDevice) {
    if (!ObdBluetooth || this.snap.status !== 'idle') return;
    this.values = {};
    this.history.clear();
    this.seriesCache.clear();
    this.set({
      error: null,
      status: 'connecting',
      deviceName: device.name,
      info: 'Csatlakozás az adapterhez…',
      values: {},
      dtcs: null,
      psaDtcs: null,
      dtcTime: null,
      dtcFile: null,
      car: null,
      detectedCar: null,
      factory: 'off',
      paramIds: [],
      startedAt: null,
    });
    try {
      await ObdBluetooth.connect(device.address);
      const elm = new Elm327();
      this.set({ info: 'Kapcsolódás az autóhoz (akár 10 mp)…' });
      await elm.initialize();

      this.pids.clear();
      for (const param of PARAMS) {
        if (param.source.kind !== 'pid') continue;
        const { pid, fallback } = param.source;
        const code = elm.isSupported(pid) ? pid : fallback && elm.isSupported(fallback) ? fallback : null;
        const def = code ? pidByCode(code) : undefined;
        if (def) this.pids.set(param.id, def);
      }

      this.set({ info: 'Autó felismerése…' });
      const detectedCar = await this.detect(elm);

      this.elm = elm;
      this.factorySession = null;
      this.factoryFails = 0;
      this.zoneLengths = {};
      this.round = 0;
      this.set({
        status: 'connected',
        detectedCar,
        info: `${elm.adapterVersion} · ${elm.protocol}${elm.vin ? ` · VIN: ${elm.vin}` : ''}`,
        paramIds: this.visibleParams(null, 'off'),
        startedAt: Date.now(),
      });
      this.runLoop(elm);
    } catch (e) {
      ObdBluetooth.disconnect();
      this.set({ status: 'idle', error: errorMessage(e) });
    }
  }

  /** A 21 82 zóna (szoftver-azonosító) alapján megmondja, melyik autó ez. */
  private async detect(elm: Elm327): Promise<CarId | null> {
    let session: string | null = null;
    try {
      session = await openSession(elm, ENGINE);
      return session ? detectCar(await readZone(elm, '82')) : null;
    } catch {
      return null;
    } finally {
      await closeSession(elm, session);
    }
  }

  /** Autó kiválasztása: ettől kezdve a gyári adatokat is gyűjti. */
  selectCar(car: CarId) {
    if (this.snap.status !== 'connected' || this.snap.recording) return;
    this.factoryFails = 0;
    this.set({ car, factory: 'pending', paramIds: this.visibleParams(car, 'pending') });
  }

  /** Autóváltás: újra megjelenik a választó, a gyári adatok olvasása addig szünetel. */
  clearCar() {
    if (this.snap.status !== 'connected' || this.snap.recording) return;
    this.factorySession = null;
    this.set({ car: null, factory: 'off', paramIds: this.visibleParams(null, 'off') });
  }

  async disconnect(error: string | null = null) {
    this.loopId++;
    await this.stopRecording();
    this.elm = null;
    this.factorySession = null;
    ObdBluetooth?.disconnect();
    // Ha épp egy kizárólagos művelet várt a ciklusra, engedjük tovább.
    this.onParked?.();
    this.onParked = null;
    // A megállított ciklus is lépjen ki.
    this.wake?.();
    this.wake = null;
    this.set({ status: 'idle', error, busy: null, factory: 'off' });
  }

  private visibleParams(car: CarId | null, factory: FactoryState): string[] {
    return PARAMS.filter((p) => {
      if (p.source.kind === 'battery') return true;
      const zonesOn = car != null && factory !== 'off' && factory !== 'unavailable';
      if (p.source.kind === 'pid') return this.pids.has(p.id) || (p.source.zone != null && zonesOn);
      return zonesOn;
    }).map((p) => p.id);
  }

  // --- Adatgyűjtő ciklus ------------------------------------------------------------------

  private async runLoop(elm: Elm327) {
    const id = ++this.loopId;
    const active = () => this.loopId === id;
    while (active()) {
      if (this.pauseCount > 0) {
        this.parked = true;
        this.onParked?.();
        this.onParked = null;
        await new Promise<void>((resolve) => (this.wake = resolve));
        this.parked = false;
        continue;
      }
      try {
        await this.readRound(elm, active);
      } catch (e) {
        if (!active()) return;
        if (!ObdBluetooth?.isConnected()) {
          await this.disconnect(errorMessage(e));
          return;
        }
      }
    }
  }

  private async readRound(elm: Elm327, active: () => boolean) {
    const row: Row = { time: Date.now(), values: {}, raw: {} };
    const ids = this.snap.paramIds;

    const fastSet = this.snap.factory === 'ok' ? FAST_PARAMS_WITH_ZONES : FAST_PARAMS;
    const fast = ids.filter((id) => fastSet.has(id) && this.pids.has(id));
    const slow = ids.filter((id) => !fastSet.has(id) && (this.pids.has(id) || id === 'battery'));
    const slowNow: string[] = [];
    for (let i = 0; i < Math.min(SLOW_PER_ROUND, slow.length); i++) {
      slowNow.push(slow[this.slowIndex++ % slow.length]);
    }

    for (const id of [...fast, ...slowNow]) {
      if (!active()) return;
      const value =
        id === 'battery'
          ? await elm.readBatteryVoltage().catch(() => null)
          : await elm.readPid(this.pids.get(id)!).catch((e) => {
              if (!ObdBluetooth?.isConnected()) throw e;
              return null;
            });
      this.store(id, value, row);
    }

    const { car, factory } = this.snap;
    if (car && (factory === 'pending' || factory === 'ok') && active()) {
      const zones = [...ZONES_EVERY_ROUND, ZONES_ROTATING[this.round % ZONES_ROTATING.length]];
      await this.readZones(elm, zones, row, active);
    }
    this.round++;
    this.maybeEmit();
    this.writeRow(row);
  }

  private store(id: string, value: number | null, row: Row) {
    row.values[id] = value;
    this.values[id] = value;
    if (value == null) return;
    let series = this.history.get(id);
    if (!series) {
      series = { t: [], v: [] };
      this.history.set(id, series);
    }
    series.t.push(row.time);
    series.v.push(value);
    if (series.t.length > HISTORY_LIMIT) {
      series.t.splice(0, HISTORY_LIMIT / 2);
      series.v.splice(0, HISTORY_LIMIT / 2);
    }
    this.maybeEmit();
  }

  private async readZones(elm: Elm327, zones: ZoneId[], row: Row, active: () => boolean) {
    let gotAny = false;
    try {
      if (this.factorySession) {
        // A munkamenet nyitva maradt, elég a fejlécet és a válaszcímet visszaállítani. A
        // folytatásjelzés (ATFCSM1, ATFCSH) beállítva marad: a körben olvasott szabványos
        // PID-ek egy képkockásak, azokhoz nem kell.
        await elm.send(`ATSH${ENGINE.tx}`);
        await elm.send(`ATCRA${ENGINE.rx}`);
      } else {
        this.factorySession = await openSession(elm, ENGINE);
      }
      if (this.factorySession) {
        for (const zone of zones) {
          if (!active()) break;
          const reply = await readZoneChecked(elm, zone);
          if (!reply) continue;
          gotAny = true;
          // A nyers választ csonkán is naplózzuk (a visszafejtéshez), de értéket csak a
          // hiánytalanból számolunk, különben elcsúszott bájtokból szemét kerülne a naplóba.
          row.raw[zone] = reply.data;
          const bytes = hexBytes(reply.data);
          const longest = this.zoneLengths[zone] ?? 0;
          if (!reply.complete || bytes.length < longest) continue;
          this.zoneLengths[zone] = bytes.length;
          for (const param of PARAMS) {
            const src = param.source;
            if (src.kind === 'zone' && src.zone === zone) {
              this.store(param.id, src.decode(bytes), row);
            } else if (src.kind === 'pid' && src.zone?.zone === zone && !this.pids.has(param.id)) {
              // A szabványos PID-et az autó nem adja: a gyári zónából pótoljuk.
              this.store(param.id, src.zone.decode(bytes), row);
            }
          }
        }
      }
    } finally {
      // Vissza a szabványos OBD címre (a munkamenet nyitva marad).
      for (const command of ['ATCRA', 'ATSH7DF']) {
        await elm.send(command).catch(() => {});
      }
    }

    if (gotAny) {
      this.factoryFails = 0;
      if (this.snap.factory !== 'ok') this.set({ factory: 'ok' });
    } else {
      // Lehet, hogy a munkamenet lejárt: legközelebb újranyitjuk.
      this.factorySession = null;
      this.factoryFails++;
      if (this.snap.factory === 'pending' && this.factoryFails >= 3) {
        this.set({ factory: 'unavailable', paramIds: this.visibleParams(this.snap.car, 'unavailable') });
      }
    }
  }

  // --- Grafikon adatok -------------------------------------------------------------------

  /**
   * Egy paraméter előzménye. `windowMs` megadásával csak az utolsó ennyi ms. A `version`
   * paraméter miatt friss adatot ad, amikor új érték jön (a képernyő frissítéséhez kell).
   */
  series(id: string, windowMs: number | null, version: number): Series {
    const key = `${id}|${windowMs}`;
    const cached = this.seriesCache.get(key);
    if (cached && cached.version === version) return cached.data;
    const full = this.history.get(id);
    let data: Series = { t: [], v: [] };
    if (full && full.t.length > 0) {
      let start = 0;
      if (windowMs != null) {
        const from = Date.now() - windowMs;
        // Visszafelé keresünk, mert az ablak a végén van.
        start = full.t.length;
        while (start > 0 && full.t[start - 1] >= from) start--;
      }
      data = { t: full.t.slice(start), v: full.v.slice(start) };
    }
    this.seriesCache.set(key, { version, data });
    return data;
  }

  // --- Rögzítés ---------------------------------------------------------------------------

  async startRecording() {
    const elm = this.elm;
    const { car, status, recording, factory } = this.snap;
    if (!elm || !car || status !== 'connected' || recording) return;
    requestNotificationPermission();

    const params = this.visibleParams(car, factory === 'off' ? 'pending' : factory)
      .map((id) => PARAMS.find((p) => p.id === id)!)
      .filter(Boolean);
    const withZones = factory === 'pending' || factory === 'ok';
    const columns = ['ido', 'ms'];
    const cells: RecordingState['cells'] = [];
    const add = (column: string, cell: RecordingState['cells'][number]) => {
      columns.push(column);
      cells.push(cell);
    };
    for (const p of params) {
      if (p.source.kind === 'pid') {
        const def = this.pids.get(p.id);
        if (def) {
          // A [01xx] végződés kell a naplóelemzőnek (scripts/analyze-log.py).
          add(csvLabel(`${def.label} (${def.unit}) [01${def.pid}]`), { kind: 'param', id: p.id, decimals: def.decimals });
        } else if (p.source.zone && withZones) {
          const z = p.source.zone;
          add(csvLabel(`${p.label} (${p.unit || '-'}) [21${z.zone} b${z.bytes}]`), {
            kind: 'param',
            id: p.id,
            decimals: p.decimals,
          });
        }
      } else if (p.source.kind === 'battery') {
        add('Akkumulátor (V) [ATRV]', { kind: 'param', id: p.id, decimals: 2 });
      }
    }
    if (withZones) {
      for (const zone of ALL_ZONES) add(`${ENGINE.tx}.21${zone}`, { kind: 'zone', zone });
      for (const p of params) {
        if (p.source.kind !== 'zone') continue;
        add(csvLabel(`${p.label} (${p.unit || '-'}) [21${p.source.zone} b${p.source.bytes}]`), {
          kind: 'param',
          id: p.id,
          decimals: p.decimals,
        });
      }
    }
    // Csak abban a sorban van értéke, amikor rögzítés közben hibakódot olvastak ki.
    add('Hibakódok [03 + 6A8]', { kind: 'dtc' });

    const startedAt = new Date();
    const header =
      `# Clapp napló – Autó: ${CARS[car].label} – VIN: ${elm.vin ?? 'ismeretlen'}` +
      `${withZones ? ` – ${ENGINE.label} ${ENGINE.tx}/${ENGINE.rx}` : ''}\n${columns.join(';')}\n`;
    try {
      const file = await createLogFile(header, `${car}${elm.vin ? `-${elm.vin}` : ''}`, startedAt);
      this.recordingState = {
        file,
        columns,
        cells,
        writes: Promise.resolve(),
        name: file.name,
        uri: file.uri,
        rows: 0,
        startedAt: startedAt.getTime(),
      };
      ObdBluetooth?.setKeepScreenOn?.(true);
      try {
        ObdBluetooth?.startRecordingService?.('Clapp – adatrögzítés', `${CARS[car].label}: a rögzítés a háttérben is fut`);
      } catch {
        // Régebbi build: háttérszolgáltatás nélkül is rögzít, amíg az app előtérben van.
      }
      this.set({ recording: this.publicRecording(), error: null });
    } catch (e) {
      this.set({ error: errorMessage(e) });
    }
  }

  private publicRecording(): Recording | null {
    const r = this.recordingState;
    return r ? { name: r.name, uri: r.uri, rows: r.rows, startedAt: r.startedAt } : null;
  }

  private writeRow(row: Row) {
    const r = this.recordingState;
    // A rögzítés indítása előtt kezdett kör nem kerül a fájlba.
    if (!r || row.time < r.startedAt) return;
    const cells = r.cells.map((cell) => {
      if (cell.kind === 'zone') return row.raw[cell.zone] ?? '';
      if (cell.kind === 'dtc') return row.dtc ?? '';
      const value = row.values[cell.id];
      return value == null ? '' : value.toFixed(cell.decimals);
    });
    const line = [new Date(row.time).toISOString(), String(row.time - r.startedAt), ...cells].join(';') + '\n';
    r.rows++;
    r.writes = r.writes
      .then(() => r.file.append(line))
      .catch((e) => {
        this.set({ error: `Nem sikerült írni a fájlt: ${errorMessage(e)}` });
      });
    this.set({ recording: this.publicRecording() });
  }

  async stopRecording() {
    const r = this.recordingState;
    if (!r) return;
    this.recordingState = null;
    ObdBluetooth?.setKeepScreenOn?.(false);
    try {
      ObdBluetooth?.stopRecordingService?.();
    } catch {
      // Régebbi build.
    }
    await r.writes;
    // Üres fájlt (csak fejléc) nem hagyunk meg.
    if (r.rows === 0) await deleteLogFile(r.uri).catch(() => {});
    this.set({ recording: null });
  }

  // --- Kizárólagos műveletek (hibakódok) ------------------------------------------------------

  private async exclusive<T>(label: string, fn: (elm: Elm327) => Promise<T>): Promise<T | undefined> {
    const elm = this.elm;
    if (!elm || this.snap.busy) return undefined;
    this.pauseCount++;
    this.set({ busy: label, error: null });
    try {
      if (!this.parked) await new Promise<void>((resolve) => (this.onParked = resolve));
      if (this.elm !== elm) return undefined;
      // A gyári munkamenetet lezárjuk, és szabványos címre állunk.
      await closeSession(elm, this.factorySession);
      this.factorySession = null;
      return await fn(elm);
    } catch (e) {
      this.set({ error: errorMessage(e) });
      return undefined;
    } finally {
      this.pauseCount--;
      this.set({ busy: null });
      if (this.pauseCount === 0) {
        this.wake?.();
        this.wake = null;
      }
    }
  }

  /** Szabványos és gyári (6A8) hibakódok egy menetben. A gyári kódokhoz törlést nem küldünk. */
  private async readAllDtcs(elm: Elm327) {
    const obdCodes = await elm.readDtcs();
    const psa = await readPsaDtcs(elm, ENGINE).catch(() => null);
    return {
      obdCodes,
      psaCodes: psa?.request ? psa.dtcs : null,
      psaRequest: psa?.request ?? null,
      psaRaw: psa?.raw ?? null,
    };
  }

  async readDtcs() {
    const result = await this.exclusive('Hibakódok olvasása…', (elm) => this.readAllDtcs(elm));
    if (result) await this.saveDtcs(result, 'kiolvasás');
  }

  async clearDtcs() {
    const result = await this.exclusive('Hibakódok törlése…', async (elm) => {
      await elm.clearDtcs();
      return this.readAllDtcs(elm);
    });
    if (result) await this.saveDtcs(result, 'törlés után');
  }

  /** Megjeleníti, külön szövegfájlba menti, és ha fut a rögzítés, a naplóba is beírja. */
  private async saveDtcs(
    result: { obdCodes: string[]; psaCodes: PsaDtc[] | null; psaRequest: string | null; psaRaw: string | null },
    reason: string
  ) {
    const time = new Date();
    const { obdCodes, psaCodes, psaRequest, psaRaw } = result;
    this.set({ dtcs: obdCodes, psaDtcs: psaCodes, dtcTime: time.getTime() });

    const psaText = (d: PsaDtc) =>
      `${d.code} (${DTC_STATE_LABELS[d.state]}, ${psaRequest === '17FF00' ? 'adatbájt' : 'státusz'} 0x${d.status}${
        d.lamp ? ', hibalámpa' : ''
      })`;

    // A naplóba egy cellába: „OBD: P0110 | 6A8: P1445 (aktív, státusz 0x60)”.
    const cell = csvLabel(
      `OBD: ${obdCodes.length ? obdCodes.join(' ') : 'nincs'} | 6A8: ${
        psaCodes == null ? 'nem válaszolt' : psaCodes.length ? psaCodes.map(psaText).join(' ') : 'nincs'
      }`
    );
    this.writeRow({ time: time.getTime(), values: {}, raw: {}, dtc: cell });

    const car = this.snap.car;
    const lines = [
      `Clapp hibakódok – ${car ? CARS[car].label : 'autó nincs kiválasztva'}${this.elm?.vin ? ` – VIN: ${this.elm.vin}` : ''}`,
      `${time.toLocaleString('hu-HU')} (${time.toISOString()}), ${reason}`,
      '',
      'Szabványos OBD hibakódok (Mode 03):',
      ...(obdCodes.length ? obdCodes.map((c) => `  ${c}`) : ['  nincs']),
      '',
      `Motorvezérlő gyári hibakódjai (${ENGINE.tx}/${ENGINE.rx}${psaRequest ? `, kérés: ${psaRequest}` : ''}):`,
      ...(psaCodes == null
        ? ['  a vezérlő nem válaszolt']
        : psaCodes.length
          ? psaCodes.map((d) => `  ${psaText(d)}${d.text ? ` – ${d.text}` : ''}`)
          : ['  nincs']),
      ...(psaRaw ? ['', `Nyers válasz: ${psaRaw}`] : []),
      '',
    ];
    try {
      const tag = `${car ?? 'auto'}${this.elm?.vin ? `-${this.elm.vin}` : ''}`;
      const file = await writeTextFile('clapp-hibakod', tag, lines.join('\n'), time);
      this.set({ dtcFile: file });
    } catch (e) {
      this.set({ error: `Nem sikerült menteni a hibakódokat: ${errorMessage(e)}` });
    }
  }

  clearError() {
    this.set({ error: null });
  }
}

function hexBytes(hex: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i + 1 < hex.length; i += 2) {
    const value = parseInt(hex.slice(i, i + 2), 16);
    if (Number.isNaN(value)) break;
    bytes.push(value);
  }
  return bytes;
}

export const obd = new ObdSession();

export function useObd(): Snapshot {
  return useSyncExternalStore(obd.subscribe, obd.getSnapshot, obd.getSnapshot);
}

/** Egy paraméter előzménye (`windowMs` nélkül a teljes futás), frissül az új értékekkel. */
export function useSeries(id: string, windowMs: number | null): Series {
  const { version } = useObd();
  return useMemo(() => obd.series(id, windowMs, version), [id, windowMs, version]);
}

export function paramList(ids: string[]): Param[] {
  return ids.map((id) => PARAMS.find((p) => p.id === id)).filter((p): p is Param => !!p);
}
