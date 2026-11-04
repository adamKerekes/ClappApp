/**
 * A két autó, amire az app készül. Mindkettő 2011-es 1.6 HDi, azonos motorvezérlő
 * hardverrel (PSA 96 632 414 80) és azonos gyári zónakiosztással, de más szoftverrel.
 * A VIN-t egyik sem adja ki, ezért a 21 82 zóna szoftver-azonosítójából ismerjük fel őket.
 */
export type CarId = '5008' | '508';

export type Car = {
  id: CarId;
  label: string;
  /** A 21 82 zónában szereplő szoftver/kalibráció azonosító (ASCII). */
  software: string;
  /** Rövid leírás a választó gombon. */
  note: string;
};

export const CARS: Record<CarId, Car> = {
  '5008': {
    id: '5008',
    label: 'Peugeot 5008',
    software: '817062696',
    note: '1.6 e-HDi, start-stop, robotváltó',
  },
  '508': {
    id: '508',
    label: 'Peugeot 508 SW',
    software: '812034126',
    note: '1.6 HDi 112 LE, robotváltó',
  },
};

export const CAR_IDS: CarId[] = ['5008', '508'];

/** A 21 82 zóna adatából (hex) megmondja, melyik autó ez, ha felismerhető. */
export function detectCar(zone82Hex: string | null): CarId | null {
  if (!zone82Hex) return null;
  let text = '';
  for (let i = 0; i + 1 < zone82Hex.length; i += 2) {
    text += String.fromCharCode(parseInt(zone82Hex.slice(i, i + 2), 16));
  }
  return CAR_IDS.find((id) => text.includes(CARS[id].software)) ?? null;
}
