/** Egy élő adat (Mode 01 PID) leírása és dekódolása. */
export type PidDefinition = {
  /** PID kód hexában, pl. `0C` */
  pid: string;
  label: string;
  unit: string;
  /** Ennyi tizedesjegyre kerekítve jelenik meg */
  decimals: number;
  decode: (bytes: number[]) => number;
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
