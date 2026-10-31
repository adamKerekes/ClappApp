/** Egy színes sáv a mutatós kijelzőn. */
export type GaugeZone = { from: number; to: number; color: GaugeColor };

export type GaugeColor = 'green' | 'orange' | 'red';

export type GaugeIcon = 'battery' | 'coolant' | 'thermo';

export type GaugeDefinition = {
  min: number;
  max: number;
  /** Ennyinként kerül számozott osztás a skálára. */
  step: number;
  /** Rövid felirat a számlapon, pl. VOLT, TEMP. */
  caption: string;
  /** Ikon a számlapon a felirat helyett. */
  icon?: GaugeIcon;
  zones: GaugeZone[];
};

export const GAUGE_COLORS: Record<GaugeColor, string> = {
  // A normál tartomány a számlap fehér színe.
  green: '#F2F2F2',
  orange: '#FFA133',
  red: '#E3323C',
};

const voltage: GaugeDefinition = {
  min: 8,
  max: 16,
  step: 2,
  caption: 'VOLT',
  icon: 'battery',
  zones: [
    { from: 8, to: 11.8, color: 'red' },
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
    max: 140,
    step: 20,
    caption: 'TEMP',
    icon: 'coolant',
    zones: [
      { from: 40, to: 105, color: 'green' },
      { from: 105, to: 115, color: 'orange' },
      { from: 115, to: 140, color: 'red' },
    ],
  },
  // Szívott levegő
  '0F': {
    min: -20,
    max: 80,
    step: 20,
    caption: 'AIR',
    icon: 'thermo',
    zones: [
      { from: -20, to: 45, color: 'green' },
      { from: 45, to: 60, color: 'orange' },
      { from: 60, to: 80, color: 'red' },
    ],
  },
  // Katalizátor előtte / utána
  '3C': hotGas('CAT', 650, 800),
  '3E': hotGas('CAT', 650, 800),
  // DPF előtte, kipufogógáz
  '7C': hotGas('DPF', 600, 750),
  '78': hotGas('EGT', 600, 750),
};

function hotGas(caption: string, warn: number, danger: number): GaugeDefinition {
  return {
    min: 0,
    max: 1000,
    step: 200,
    caption,
    zones: [
      { from: 0, to: warn, color: 'green' },
      { from: warn, to: danger, color: 'orange' },
      { from: danger, to: 1000, color: 'red' },
    ],
  };
}
