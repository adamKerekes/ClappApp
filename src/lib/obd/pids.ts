/** Egy élő adat (Mode 01 PID) leírása és dekódolása. */
export type PidDefinition = {
  /** PID kód hexában, pl. `0C` */
  pid: string;
  label: string;
  unit: string;
  /** Ennyi tizedesjegyre kerekítve jelenik meg */
  decimals: number;
  /** `null`, ha a válasz szerint az autó nem méri ezt az értéket. */
  decode: (bytes: number[]) => number | null;
};

export const LIVE_PIDS: PidDefinition[] = [
  { pid: '0C', label: 'Fordulatszám', unit: '1/min', decimals: 0, decode: ([a, b]) => (a * 256 + b) / 4 },
  { pid: '0D', label: 'Sebesség', unit: 'km/h', decimals: 0, decode: ([a]) => a },
  { pid: '05', label: 'Hűtővíz', unit: '°C', decimals: 0, decode: ([a]) => a - 40 },
  { pid: '04', label: 'Motorterhelés', unit: '%', decimals: 0, decode: ([a]) => (a * 100) / 255 },
  { pid: '11', label: 'Fojtószelep', unit: '%', decimals: 0, decode: ([a]) => (a * 100) / 255 },
  { pid: '0F', label: 'Szívott levegő', unit: '°C', decimals: 0, decode: ([a]) => a - 40 },
  { pid: '0B', label: 'Szívócső nyomás', unit: 'kPa', decimals: 0, decode: ([a]) => a },
  { pid: '10', label: 'Légtömegmérő', unit: 'g/s', decimals: 1, decode: ([a, b]) => (a * 256 + b) / 100 },
  { pid: '2F', label: 'Üzemanyagszint', unit: '%', decimals: 0, decode: ([a]) => (a * 100) / 255 },
  { pid: '42', label: 'ECU feszültség', unit: 'V', decimals: 1, decode: ([a, b]) => (a * 256 + b) / 1000 },
];

/** Előjeles 16 bites szám két bájtból. */
const signed16 = (high: number, low: number) => {
  const value = high * 256 + low;
  return value >= 0x8000 ? value - 0x10000 : value;
};

/** Hőmérséklet két bájtból, 0,1 °C felbontással (-40 °C-tól). */
const temp16 = (high: number, low: number) => (high * 256 + low) / 10 - 40;

/**
 * Katalizátor és részecskeszűrő (DPF/FAP) szabványos adatai. Sok autó csak egy részüket
 * ismeri, a régebbi dízelek a DPF-eseket általában egyáltalán nem.
 */
export const AFTERTREATMENT_PIDS: PidDefinition[] = [
  { pid: '3C', label: 'Kat. hőmérséklet (előtte)', unit: '°C', decimals: 0, decode: ([a, b]) => temp16(a, b) },
  { pid: '3E', label: 'Kat. hőmérséklet (utána)', unit: '°C', decimals: 0, decode: ([a, b]) => temp16(a, b) },
  {
    pid: '7C',
    label: 'DPF hőmérséklet (előtte)',
    unit: '°C',
    decimals: 0,
    // Az első bájt jelzi, melyik érzékelő létezik.
    decode: ([support, a, b]) => (support & 0x01 ? temp16(a, b) : null),
  },
  {
    pid: '78',
    label: 'Kipufogógáz hőmérséklet',
    unit: '°C',
    decimals: 0,
    decode: ([support, a, b]) => (support & 0x01 ? temp16(a, b) : null),
  },
  {
    pid: '7A',
    label: 'DPF nyomáskülönbség',
    unit: 'mbar',
    decimals: 0,
    // 0,01 kPa egységben jön, ez 0,1 mbar.
    decode: ([support, a, b]) => (support & 0x01 ? signed16(a, b) / 10 : null),
  },
  { pid: '34', label: 'Lambda (szonda 1)', unit: 'λ', decimals: 2, decode: ([a, b]) => ((a * 256 + b) * 2) / 65536 },
  { pid: '24', label: 'Lambda (szonda 1)', unit: 'λ', decimals: 2, decode: ([a, b]) => ((a * 256 + b) * 2) / 65536 },
  { pid: '44', label: 'Kért lambda', unit: 'λ', decimals: 2, decode: ([a, b]) => ((a * 256 + b) * 2) / 65536 },
];
