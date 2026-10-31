import { type Elm327, joinFrames } from './elm327';

/**
 * PSA (Peugeot, Citroën) gyári diagnosztika, csak olvasás.
 *
 * A motorvezérlő a szabványos OBD címe (7E0) mellett egy gyári címen is elérhető, ahol a
 * DiagBox is a koromtöltöttséget, a regenerálás adatait és az adalékszintet olvassa. Hogy
 * melyik "zóna" melyik érték, az nem nyilvános, ezért a zónákat végigolvassuk és nyersen
 * megmutatjuk, vezetés közben pedig naplózzuk őket a szabványos adatok mellé. A naplóból
 * visszafejthető, melyik bájt mi (pl. mi nő a koromtöltöttséggel, mi ugrik a regenerálásnál).
 * Csak olvasó (21xx) kéréseket küldünk, a vezérlőbe semmit nem írunk.
 *
 * Címek: https://github.com/ludwig-v/arduino-psa-diag/blob/master/ECU_LIST.md
 */
export type PsaEcu = {
  id: string;
  label: string;
  /** Erre a CAN azonosítóra küldjük a kérést. */
  tx: string;
  /** Erről jön a válasz. */
  rx: string;
};

export const PSA_ECUS: PsaEcu[] = [
  { id: 'engine', label: 'Motorvezérlő', tx: '6A8', rx: '688' },
  { id: 'additive', label: 'FAP adalék vezérlő', tx: '6C1', rx: '601' },
];

export type PsaZone = {
  /** Zóna száma hexában, pl. `C1` */
  zone: string;
  /** A válasz adatbájtjai hexában, a `61 xx` előtag nélkül. */
  data: string;
};

export type PsaScanResult = {
  ecu: PsaEcu;
  time: Date;
  /** Melyik kéréssel nyílt meg a diagnosztikai munkamenet (`81` vagy `10C0`). */
  session: string | null;
  zones: PsaZone[];
};

const hex2 = (n: number) => n.toString(16).toUpperCase().padStart(2, '0');

/**
 * Átállítja az adaptert a vezérlő gyári címére és megnyitja a diagnosztikai munkamenetet.
 * Visszaadja a sikeres nyitó kérést, vagy `null`-t, ha egyik sem sikerült (a fejléc ekkor
 * is a gyári címen marad, a hívónak a `closeSession`-t mindig meg kell hívnia).
 */
export async function openSession(elm: Elm327, ecu: PsaEcu, preferred: string[] = []): Promise<string | null> {
  await elm.send(`ATSH${ecu.tx}`);
  await elm.send(`ATCRA${ecu.rx}`);
  // A több képkockás válaszokhoz a "folytasd" jelzést is a gyári címre kell küldeni.
  // Néhány olcsó adapter ezt nem ismeri, akkor csak a rövid zónák jönnek át.
  await elm.send(`ATFCSH${ecu.tx}`).catch(() => {});
  await elm.send('ATFCSD300000').catch(() => {});
  await elm.send('ATFCSM1').catch(() => {});

  // A CAN-es KWP vezérlők a 81-et értik, a régebbiek és az UDS-esek a 10C0-t.
  for (const command of [...preferred, '81', '10C0']) {
    const lines = await elm.send(command, 3000).catch(() => [] as string[]);
    if (lines.some((line) => line.startsWith(positiveReply(command)))) return command;
  }
  return null;
}

/** A nyitó kérésre várt pozitív válasz eleje (pl. `10C0` -> `50C0`, `81` -> `C1`). */
function positiveReply(command: string) {
  const service = parseInt(command.slice(0, 2), 16) + 0x40;
  return service.toString(16).toUpperCase() + command.slice(2);
}

/** Lezárja a munkamenetet és visszaállítja a szabványos OBD fejléceket. */
export async function closeSession(elm: Elm327, session: string | null) {
  const close: Record<string, string> = { '81': '82', '10C0': '1081', '1003': '1001' };
  if (session) await elm.send(close[session] ?? '1081', 1000).catch(() => {});
  for (const command of ['ATFCSM0', 'ATCRA', 'ATSH7DF']) {
    await elm.send(command).catch(() => {});
  }
}

export async function readZone(elm: Elm327, zoneHex: string): Promise<string | null> {
  const lines = joinFrames(await elm.send(`21${zoneHex}`, 1500).catch(() => [] as string[]));
  const prefix = `61${zoneHex}`;
  const line = lines.find((l) => l.startsWith(prefix));
  return line && line.length > prefix.length ? line.slice(prefix.length) : null;
}

/**
 * Végigolvassa a vezérlő zónáit (2100–21FF). A szabványos lekérdezést előtte le kell
 * állítani, mert a fejléc átállítása alatt a szabványos kérések nem működnek.
 */
export async function scanPsaZones(
  elm: Elm327,
  ecu: PsaEcu,
  onProgress: (done: number, total: number) => void,
  isCancelled: () => boolean
): Promise<PsaScanResult> {
  const result: PsaScanResult = { ecu, time: new Date(), session: null, zones: [] };
  try {
    result.session = await openSession(elm, ecu);
    if (!result.session) return result;
    const total = 256;
    for (let zone = 0; zone < total; zone++) {
      if (isCancelled()) break;
      // Életben tartjuk a munkamenetet, különben pár másodperc után bezárul.
      if (zone % 16 === 15) await elm.send('3E', 1000).catch(() => {});
      const zoneHex = hex2(zone);
      const data = await readZone(elm, zoneHex);
      if (data) result.zones.push({ zone: zoneHex, data });
      onProgress(zone + 1, total);
    }
    return result;
  } finally {
    await closeSession(elm, result.session);
  }
}

/** Szöveges összefoglaló megosztáshoz. */
export function formatScan(scan: PsaScanResult, previous?: PsaScanResult | null): string {
  const changed = changedZones(scan, previous);
  const lines = [
    `Clapp PSA zónák – ${scan.ecu.label} (${scan.ecu.tx}/${scan.ecu.rx})`,
    scan.time.toLocaleString('hu-HU'),
    `Munkamenet: ${scan.session ?? 'nem nyílt meg'}`,
    '',
    ...scan.zones.map((z) => `21${z.zone}: ${z.data}${changed.has(z.zone) ? '  *' : ''}`),
  ];
  if (previous) lines.push('', '* = változott az előző olvasás óta');
  return lines.join('\n');
}

/** Azok a zónák, amelyek tartalma eltér az előző olvasástól. */
export function changedZones(scan: PsaScanResult, previous?: PsaScanResult | null): Set<string> {
  const changed = new Set<string>();
  if (!previous || previous.ecu.id !== scan.ecu.id) return changed;
  const before = new Map(previous.zones.map((z) => [z.zone, z.data]));
  for (const z of scan.zones) {
    if (before.has(z.zone) && before.get(z.zone) !== z.data) changed.add(z.zone);
  }
  return changed;
}
