/** Egy színes sáv a mutatós kijelzőn. */
export type GaugeZone = { from: number; to: number; color: GaugeColor };

export type GaugeColor = 'green' | 'orange' | 'red';

export type GaugeDefinition = {
  min: number;
  max: number;
  zones: GaugeZone[];
};

export const GAUGE_COLORS: Record<GaugeColor, string> = {
  green: '#30A46C',
  orange: '#F5A524',
  red: '#E5484D',
};

const voltage: GaugeDefinition = {
  min: 10,
  max: 16,
  zones: [
    { from: 10, to: 11.8, color: 'red' },
    { from: 11.8, to: 12.4, color: 'orange' },
    { from: 12.4, to: 14.8, color: 'green' },
    { from: 14.8, to: 15.2, color: 'orange' },
    { from: 15.2, to: 16, color: 'red' },
  ],
};

/**
 * Mely értékek kapnak mutatós kijelzőt, és milyen sávokkal. A kulcs a PID kódja,
 * az akkumulátoré `battery`. A határok tájékoztató jellegűek, nem gyári értékek.
 */
export const GAUGES: Record<string, GaugeDefinition> = {
  battery: voltage,
  '42': voltage,
  // Hűtővíz
  '05': {
    min: 40,
    max: 130,
    zones: [
      { from: 40, to: 105, color: 'green' },
      { from: 105, to: 115, color: 'orange' },
      { from: 115, to: 130, color: 'red' },
    ],
  },
  // Szívott levegő
  '0F': {
    min: -20,
    max: 80,
    zones: [
      { from: -20, to: 45, color: 'green' },
      { from: 45, to: 60, color: 'orange' },
      { from: 60, to: 80, color: 'red' },
    ],
  },
  // Katalizátor előtte / utána
  '3C': hotGas(650, 800),
  '3E': hotGas(650, 800),
  // DPF előtte, kipufogógáz
  '7C': hotGas(600, 750),
  '78': hotGas(600, 750),
};

function hotGas(warn: number, danger: number): GaugeDefinition {
  return {
    min: 0,
    max: 900,
    zones: [
      { from: 0, to: warn, color: 'green' },
      { from: warn, to: danger, color: 'orange' },
      { from: danger, to: 900, color: 'red' },
    ],
  };
}
