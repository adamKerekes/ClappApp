import type { Elm327 } from './elm327';
import { commandKey, decodeHit, type ObdbCommand, readCommand } from './obdb';
import type { PidDefinition } from './pids';
import { closeSession, openSession, type PsaEcu, readZone } from './psa';

/**
 * Vezetés közbeni napló a gyári adatok visszafejtéséhez.
 *
 * Körönként kiolvassa a kiválasztott vezérlők gyári adatait (21xx zónák és a válaszoló
 * OBDb kérések) nyersen, utána a szabványos értékeket (fordulat, sebesség, hőfokok…).
 * Minden sor azonnal a telefonra, egy CSV fájlba kerül, így a napló hossza nincs korlátozva.
 * A fájlból a `scripts/analyze-log.py` keresi meg, melyik bájt mivel mozog együtt.
 */
export type LogTarget = {
  ecu: PsaEcu;
  /** Zónák hexában, pl. `C1` (a `21` előtag nélkül) */
  zones: string[];
  /** Az OBDb kérések közül azok, amikre az autó válaszolt */
  commands: ObdbCommand[];
  /** Ha a próbánál más nyitó kérés kellett (pl. `1003`) */
  preferredSession?: string[];
};

export type LogRow = {
  time: Date;
  values: Record<string, number | null>;
  /** Nyers válaszok, kulcs pl. `6A8.21C1` vagy `6A8.22D400` */
  raw: Record<string, string>;
};

const zoneKey = (ecu: PsaEcu, zone: string) => `${ecu.tx}.21${zone}`;

/** A napló oszlopai: időpont, szabványos értékek, nyers válaszok, ismert jelek. */
export function logColumns(targets: LogTarget[], pids: PidDefinition[]): string[] {
  return [
    'ido',
    'ms',
    ...pids.map((p) => `${p.label} (${p.unit}) [01${p.pid}]`),
    ...targets.flatMap((t) => [
      ...t.zones.map((z) => zoneKey(t.ecu, z)),
      ...t.commands.map((c) => commandKey(c)),
    ]),
    ...targets.flatMap((t) =>
      t.commands.flatMap((c) => c.signals.map((s) => `${s.name} (${s.unit}) [${commandKey(c)}]`))
    ),
  ];
}

export function logCsvHeader(targets: LogTarget[], pids: PidDefinition[], vin: string | null): string {
  const comment = targets.map((t) => `${t.ecu.label} ${t.ecu.tx}/${t.ecu.rx}`).join(', ');
  return `# Clapp napló – VIN: ${vin ?? 'ismeretlen'} – ${comment}\n${logColumns(targets, pids).join(';')}\n`;
}

export function logCsvLine(row: LogRow, startedAt: Date, targets: LogTarget[], pids: PidDefinition[]): string {
  const decoded = targets.flatMap((t) =>
    t.commands.flatMap((c) => {
      const data = row.raw[commandKey(c)];
      return data ? decodeHit(c, data).map((v) => (v == null ? '' : String(v))) : c.signals.map(() => '');
    })
  );
  return (
    [
      row.time.toISOString(),
      String(row.time.getTime() - startedAt.getTime()),
      ...pids.map((p) => row.values[p.pid]?.toFixed(p.decimals) ?? ''),
      ...targets.flatMap((t) => [
        ...t.zones.map((z) => row.raw[zoneKey(t.ecu, z)] ?? ''),
        ...t.commands.map((c) => row.raw[commandKey(c)] ?? ''),
      ]),
      ...decoded,
    ].join(';') + '\n'
  );
}

/** Napló egy köre. */
export async function readLogRow(elm: Elm327, targets: LogTarget[], pids: PidDefinition[]): Promise<LogRow> {
  const row: LogRow = { time: new Date(), values: {}, raw: {} };
  for (const target of targets) {
    let session: string | null = null;
    try {
      session = await openSession(elm, target.ecu, target.preferredSession);
      for (const zone of target.zones) {
        const data = session ? await readZone(elm, zone) : null;
        if (data) row.raw[zoneKey(target.ecu, zone)] = data;
      }
      for (const command of target.commands) {
        const reply = await readCommand(elm, command);
        if (reply.kind === 'data') row.raw[commandKey(command)] = reply.data;
      }
    } finally {
      await closeSession(elm, session);
    }
  }
  for (const pid of pids) {
    row.values[pid.pid] = await elm.readPid(pid).catch(() => null);
  }
  return row;
}

/** A naplófájlok helye és kezelése a telefonon. Csak natív buildben működik. */
export type LogFile = {
  name: string;
  uri: string;
  append(text: string): Promise<void>;
};

const LOG_DIR = 'naplok';

async function logDirectory() {
  const { Directory, Paths } = await import('expo-file-system');
  const dir = new Directory(Paths.document, LOG_DIR);
  dir.create({ idempotent: true, intermediates: true });
  return dir;
}

export async function createLogFile(header: string, vin: string | null, time = new Date()): Promise<LogFile> {
  const { File } = await import('expo-file-system');
  const dir = await logDirectory();
  const stamp = time.toISOString().slice(0, 19).replace(/[:T]/g, '-');
  // A fájlnévben az alvázszám, így a lista autónként szétválik.
  const file = new File(dir, `clapp-naplo-${vin ?? 'ismeretlen-auto'}-${stamp}.csv`);
  file.create({ overwrite: true });
  await file.write(header);
  return {
    name: file.name,
    uri: file.uri,
    append: (text) => file.write(text, { append: true }),
  };
}

export type SavedLog = { name: string; uri: string; size: number };

/** A telefonon tárolt naplók, a legújabb elöl. */
export async function listLogFiles(): Promise<SavedLog[]> {
  const { File } = await import('expo-file-system');
  const dir = await logDirectory();
  return dir
    .list()
    .filter((item): item is InstanceType<typeof File> => item instanceof File && item.name.endsWith('.csv'))
    .map((f) => ({ name: f.name, uri: f.uri, size: f.size ?? 0 }))
    .sort((a, b) => b.name.slice(-23).localeCompare(a.name.slice(-23)));
}

export async function deleteLogFile(uri: string): Promise<void> {
  const { File } = await import('expo-file-system');
  new File(uri).delete();
}

/** A fájl megosztása (e-mail, Drive, üzenet…). */
export async function shareLogFile(uri: string): Promise<void> {
  const Sharing = await import('expo-sharing');
  await Sharing.shareAsync(uri, { mimeType: 'text/csv', dialogTitle: 'Clapp napló megosztása' });
}
