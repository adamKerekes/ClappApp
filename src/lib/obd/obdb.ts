import data from './data/obdb-peugeot-508.json';
import { type Elm327, hexToBytes, joinFrames } from './elm327';
import { closeSession, openSession, type PsaEcu } from './psa';

/**
 * Az OBDb közösségi adatbázis Peugeot 508 jelkészlete (367 jel, 353 kérés).
 * Forrás: https://github.com/OBDb/Peugeot-508 (CC BY-SA 4.0), átalakítva a
 * `scripts/import-obdb.js` szkripttel.
 *
 * Egyik tétele sincs autón igazolva, és főleg az újabb (2014 utáni) motorokhoz készült,
 * ezért először végigpróbáljuk, melyik kérésre válaszol az adott autó.
 */
export type ObdbSignal = {
  id: string;
  name: string;
  group: string;
  unit: string;
  /** Hány bites az érték */
  len: number;
  /** Hányadik bitnél kezdődik a válasz adatrészében (az azonosító után) */
  bix?: number;
  /** Előjeles (kettes komplemens) */
  sign?: boolean;
  /** A bájtok fordított (kicsi a végén) sorrendben vannak */
  blsb?: boolean;
  mul?: number;
  div?: number;
  add?: number;
};

export type ObdbCommand = {
  /** Erre a CAN címre küldjük (pl. 6A8) */
  tx: string;
  /** Erről jön a válasz (pl. 688) */
  rx: string;
  /** Szolgáltatás: `22` (azonosító olvasása) vagy `21` (zóna olvasása) */
  service: string;
  /** Azonosító, pl. `D400` */
  id: string;
  /** Diagnosztikai munkamenet, amit a forrás megad (`C0`, `03`) */
  session?: string;
  signals: ObdbSignal[];
};

export const OBDB_COMMANDS = data as ObdbCommand[];

export const OBDB_SIGNAL_COUNT = OBDB_COMMANDS.reduce((n, c) => n + c.signals.length, 0);

/** A kérés szövege, pl. `22D400`. */
export const commandText = (c: ObdbCommand) => `${c.service}${c.id}`;

/** Egyedi kulcs a naplóhoz: cím és kérés, pl. `6A8.22D400`. */
export const commandKey = (c: ObdbCommand) => `${c.tx}.${commandText(c)}`;

/** Az OBDb címei mint vezérlők, hogy a PSA munkamenet-kezelés használni tudja őket. */
export const OBDB_ECUS: PsaEcu[] = [
  { id: 'engine', label: 'Motorvezérlő', tx: '6A8', rx: '688' },
  { id: 'gearbox', label: 'Automata váltó', tx: '6A9', rx: '689' },
];

/** Egy jel értéke a válasz adatbájtjaiból. `null`, ha a válasz rövidebb a vártnál. */
export function decodeSignal(signal: ObdbSignal, bytes: number[]): number | null {
  const start = signal.bix ?? 0;
  if (start + signal.len > bytes.length * 8) return null;

  let raw = 0;
  if (signal.blsb && start % 8 === 0 && signal.len % 8 === 0) {
    // Kicsi a végén: az első bájt a legkisebb helyiértékű.
    const first = start / 8;
    for (let i = signal.len / 8 - 1; i >= 0; i--) raw = raw * 256 + bytes[first + i];
  } else {
    for (let bit = start; bit < start + signal.len; bit++) {
      const value = (bytes[bit >> 3] >> (7 - (bit & 7))) & 1;
      raw = raw * 2 + value;
    }
  }
  if (signal.sign && raw >= 2 ** (signal.len - 1)) raw -= 2 ** signal.len;

  const value = (raw * (signal.mul ?? 1)) / (signal.div ?? 1) + (signal.add ?? 0);
  return Number.isFinite(value) ? value : null;
}

export type ObdbReply =
  | { kind: 'data'; data: string }
  /** A vezérlő elutasította; a kód megmondja, miért (pl. 31 = nem ismeri az azonosítót). */
  | { kind: 'negative'; code: string }
  | { kind: 'none' };

const hex2 = (n: number) => n.toString(16).toUpperCase().padStart(2, '0');

/** Egy OBDb kérés elküldése. A munkamenetnek már nyitva kell lennie a megfelelő címen. */
export async function readCommand(elm: Elm327, command: ObdbCommand, timeoutMs = 1500): Promise<ObdbReply> {
  const lines = joinFrames(await elm.send(commandText(command), timeoutMs).catch(() => [] as string[]));
  const positive = `${hex2(parseInt(command.service, 16) + 0x40)}${command.id}`;
  const data = lines.find((l) => l.startsWith(positive));
  if (data) return { kind: 'data', data: data.slice(positive.length) };
  const negative = lines.find((l) => l.startsWith(`7F${command.service}`));
  if (negative) return { kind: 'negative', code: negative.slice(4, 6) };
  return { kind: 'none' };
}

export type ObdbHit = {
  command: ObdbCommand;
  data: string;
  values: (number | null)[];
};

export type ObdbGroupResult = {
  ecu: PsaEcu;
  /** A kéréscsoport munkamenete a forrás szerint (`C0`, `03` vagy üres) */
  sourceSession: string | null;
  /** Melyik kéréssel nyílt meg a munkamenet, ha megnyílt */
  session: string | null;
  asked: number;
  hits: ObdbHit[];
  /** Elutasítások száma kódonként (pl. `{ "31": 120 }`) */
  negative: Record<string, number>;
  silent: number;
  /** Ha a vezérlő egyáltalán nem válaszolt, a csoportot korán abbahagyjuk. */
  gaveUp: boolean;
};

export type ObdbProbeResult = {
  time: Date;
  groups: ObdbGroupResult[];
};

export const decodeHit = (command: ObdbCommand, data: string) =>
  command.signals.map((s) => decodeSignal(s, hexToBytes(data)));

/** Ennyi egymás utáni néma kérés után feladjuk a csoportot (nincs ott vezérlő). */
const SILENT_LIMIT = 8;

/**
 * Végigkérdezi az összes OBDb kérést, és megjegyzi, melyikre válaszol az autó.
 * Csak olvasó kéréseket küld (21, 22). A szabványos lekérdezést előtte le kell állítani.
 */
export async function probeObdb(
  elm: Elm327,
  onProgress: (done: number, total: number) => void,
  isCancelled: () => boolean
): Promise<ObdbProbeResult> {
  const result: ObdbProbeResult = { time: new Date(), groups: [] };
  const groups = new Map<string, ObdbCommand[]>();
  for (const c of OBDB_COMMANDS) {
    const key = `${c.tx}|${c.session ?? ''}`;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }

  const total = OBDB_COMMANDS.length;
  let processed = 0;
  for (const commands of groups.values()) {
    if (isCancelled()) break;
    const first = commands[0];
    const ecu = OBDB_ECUS.find((e) => e.tx === first.tx) ?? {
      id: first.tx,
      label: first.tx,
      tx: first.tx,
      rx: first.rx,
    };
    const group: ObdbGroupResult = {
      ecu,
      sourceSession: first.session ?? null,
      session: null,
      asked: 0,
      hits: [],
      negative: {},
      silent: 0,
      gaveUp: false,
    };
    result.groups.push(group);
    try {
      group.session = await openSession(elm, ecu, first.session === '03' ? ['1003'] : undefined);
      let silentRun = 0;
      for (const [index, command] of commands.entries()) {
        if (isCancelled()) break;
        // Életben tartjuk a munkamenetet.
        if (index % 16 === 15) await elm.send('3E00', 1000).catch(() => {});
        const reply = await readCommand(elm, command);
        group.asked++;
        if (reply.kind === 'data') {
          group.hits.push({ command, data: reply.data, values: decodeHit(command, reply.data) });
          silentRun = 0;
        } else if (reply.kind === 'negative') {
          group.negative[reply.code] = (group.negative[reply.code] ?? 0) + 1;
          silentRun = 0;
        } else {
          group.silent++;
          silentRun++;
        }
        onProgress(processed + index + 1, total);
        if (silentRun >= SILENT_LIMIT && group.hits.length === 0) {
          group.gaveUp = true;
          break;
        }
      }
    } finally {
      await closeSession(elm, group.session);
    }
    processed += commands.length;
    onProgress(processed, total);
  }
  return result;
}

/** Az elutasítási kódok jelentése, amik itt előfordulhatnak. */
export const NEGATIVE_CODES: Record<string, string> = {
  '11': 'nem ismeri a szolgáltatást',
  '12': 'nem ismeri az alfunkciót',
  '13': 'hibás hossz',
  '22': 'most nem teljesíthető',
  '31': 'nem ismeri az azonosítót',
  '33': 'zárolt (biztonsági hozzáférés kell)',
  '7E': 'ebben a munkamenetben nem',
  '7F': 'ebben a munkamenetben nem',
};

/** Szöveges összefoglaló megosztáshoz. */
export function formatProbe(probe: ObdbProbeResult): string {
  const lines = [
    'Clapp – OBDb Peugeot 508 próba',
    probe.time.toLocaleString('hu-HU'),
    `Forrás: github.com/OBDb/Peugeot-508 (CC BY-SA 4.0), ${OBDB_COMMANDS.length} kérés, ${OBDB_SIGNAL_COUNT} jel`,
  ];
  for (const g of probe.groups) {
    lines.push(
      '',
      `${g.ecu.label} (${g.ecu.tx}/${g.ecu.rx}), forrás munkamenet: ${g.sourceSession ?? '-'}, megnyitva: ${g.session ?? 'nem'}`,
      `Kérdezve: ${g.asked}, válasz: ${g.hits.length}, elutasítás: ${Object.entries(g.negative)
        .map(([code, n]) => `${code}×${n}`)
        .join(' ') || '0'}, néma: ${g.silent}${g.gaveUp ? ' (feladva, nem válaszol)' : ''}`
    );
    for (const hit of g.hits) {
      lines.push(`${commandText(hit.command)}: ${hit.data}`);
      hit.command.signals.forEach((s, i) => {
        const v = hit.values[i];
        lines.push(`   ${s.name}: ${v == null ? '–' : formatNumber(v)} ${s.unit}`);
      });
    }
  }
  return lines.join('\n');
}

export function formatNumber(value: number): string {
  return Math.abs(value) >= 100 || Number.isInteger(value) ? value.toFixed(0) : value.toFixed(2);
}
