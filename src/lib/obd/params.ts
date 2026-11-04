import type { CarId } from './cars';

/**
 * Az élő paraméterlista: minden kijelzett érték leírása, honnan jön, milyen tartományban
 * kell mutatni, és mit jelent a két autón. A tartalom a projekt tudásbázisából
 * (`clapp/tudasbazis.md`) és a naplóelemzésekből (`clapp/elemzes/`) származik.
 *
 * Bizonyosság (a tudásbázis jelöléseivel):
 * - `identified`: ✅ autón mért adatból igazolva, vagy szabványos OBD érték.
 * - `questionable`: 🟡 a viselkedés illik rá, de még nincs igazolva.
 * - `unidentified`: ❓ változó gyári adat, a jelentése még nem ismert (nyers érték).
 */
export type ParamStatus = 'identified' | 'questionable' | 'unidentified';

export const STATUS_LABELS: Record<ParamStatus, string> = {
  identified: 'Azonosított',
  questionable: 'Kérdéses',
  unidentified: 'Nem azonosított',
};

export const STATUS_TEXT: Record<ParamStatus, string> = {
  identified: 'Egyértelműen azonosított: autón mért adatból igazolva, vagy szabványos OBD érték.',
  questionable:
    'Kérdéses: a viselkedése illik a jelentésre, de még nincs igazolva (pl. regenerálás kell hozzá). A név és a mértékegység tévedhet.',
  unidentified:
    'Nem azonosított: folyamatosan változó gyári adat, aminek a jelentése még nem ismert. Nyers számot mutat, a naplóba a visszafejtéshez kerül be.',
};

/** Gyári zóna (motorvezérlő 6A8/688, `21xx`), hexában a `21` nélkül. */
export type ZoneId = 'CA' | 'CB' | 'C7' | 'CC' | 'CD' | 'DC';

export type ParamSource =
  /** Szabványos OBD (Mode 01) PID; ha az autó nem ismeri, a `fallback` PID-et kérdezzük. */
  | { kind: 'pid'; pid: string; fallback?: string }
  /** Az adapter által mért feszültség (`ATRV`). */
  | { kind: 'battery' }
  /** Gyári zóna bájtjai; a bájtszámozás a `61xx` utáni első adatbájttól 0. */
  | { kind: 'zone'; zone: ZoneId; bytes: string; decode: (b: number[]) => number | null };

export type Param = {
  id: string;
  label: string;
  unit: string;
  decimals: number;
  status: ParamStatus;
  source: ParamSource;
  /** A grafikon függőleges tartománya. Ha nincs, az adatokhoz igazodik (számlálók, nyers értékek). */
  range?: [number, number];
  /** Az optimális (normál) sáv, a grafikonon halványan jelölve. */
  ok?: [number, number];
  /** Saját kijelzés (pl. hexa állapotbájt). */
  format?: (value: number) => string;
  /** Mi ez a paraméter. */
  description: string;
  /** Mi az optimális érték. */
  optimal: string;
  /** Mit jelent az érték a konkrét autón (mérésekből). */
  cars: Record<CarId, string>;
};

// --- Bájt segédek -----------------------------------------------------------------------

const u8 = (i: number) => (b: number[]) => (b.length > i ? b[i] : null);
const u16 = (i: number) => (b: number[]) => (b.length > i + 1 ? b[i] * 256 + b[i + 1] : null);
const u24 = (i: number) => (b: number[]) =>
  b.length > i + 2 ? b[i] * 65536 + b[i + 1] * 256 + b[i + 2] : null;

const hex = (v: number) => `0x${Math.round(v).toString(16).toUpperCase().padStart(2, '0')}`;

// --- Paraméterek -------------------------------------------------------------------------

export const PARAMS: Param[] = [
  // ✅ Azonosított -----------------------------------------------------------------------
  {
    id: 'rpm',
    label: 'Fordulatszám',
    unit: '1/min',
    decimals: 0,
    status: 'identified',
    source: { kind: 'pid', pid: '0C' },
    range: [0, 4500],
    ok: [700, 3000],
    description:
      'A motor főtengelyének percenkénti fordulata (szabványos OBD, 010C). A gyári 21C7–21CE zónák 0–1. bájtja ugyanezt adja.',
    optimal:
      'Meleg motorral alapjáraton 750–800 1/min. Dízelnél a gazdaságos tartomány 1500–2500 1/min, 4000 fölött már a leszabályozás jön.',
    cars: {
      '5008':
        'Mért alapjárat kb. 790 1/min. Ez e-HDi start-stopos autó: álló autónál a 0 normális, a motor leáll és magától újraindul.',
      '508':
        'Mért alapjárat 770–780 1/min, stabil: rendben. Ezen nincs start-stop, álló autónál a 0 azt jelenti, hogy a motor leállt.',
    },
  },
  {
    id: 'speed',
    label: 'Sebesség',
    unit: 'km/h',
    decimals: 0,
    status: 'identified',
    source: { kind: 'pid', pid: '0D' },
    range: [0, 160],
    description: 'A jármű sebessége a motorvezérlő szerint (szabványos OBD, 010D).',
    optimal: 'Nincs optimális érték. A regeneráláshoz 20–30 perc egyenletes 90–120 km/h a legjobb.',
    cars: {
      '5008':
        'A gyári 21C7 zóna 2. bájtjával r = 0,998 egyezés. A koromjelölt magas, egy hosszabb 100–120 km/h-s szakasz javasolt.',
      '508': 'A gyári 21C7 zóna 2. bájtjával r = 0,997 egyezés.',
    },
  },
  {
    id: 'coolant',
    label: 'Hűtővíz hőmérséklet',
    unit: '°C',
    decimals: 0,
    status: 'identified',
    source: { kind: 'pid', pid: '05' },
    range: [0, 120],
    ok: [80, 100],
    description:
      'A motor hűtőfolyadékának hőmérséklete (szabványos OBD, 0105). A gyári zónákban 21CD b3, 21C7 b8 és 21AD b8 ugyanez (nyers − 50).',
    optimal:
      'Üzemi hőfokon 80–95 °C. 105 °C fölött figyelni kell, 115 °C fölött túlmelegedés. Ha télen tartósan 70 °C alatt marad, a termosztát gyanús.',
    cars: {
      '5008':
        'Kb. 80 °C-nál nyit a termosztát, utána városban 71–78 °C, autópályán 80–89 °C. 42 → 77 °C kb. 7,5 perc. Hideg időben városban enyhén alacsony: a termosztát figyelendő.',
      '508': 'Menet közben 77–85 °C, 40 → 80 °C kb. 8 perc alatt: normális, termosztáthibára nem utal.',
    },
  },
  {
    id: 'battery',
    label: 'Akkumulátor feszültség',
    unit: 'V',
    decimals: 1,
    status: 'identified',
    source: { kind: 'battery' },
    range: [10, 16],
    ok: [12.4, 14.8],
    description: 'Az OBD csatlakozó 16. tűjén mért feszültség, az adapter méri (ATRV).',
    optimal:
      'Járó motorral 13,8–14,8 V (töltés). Álló motorral 12,4–12,8 V a feltöltött akku, 12,0 V alatt gyenge. Indításkor rövid esés normális.',
    cars: {
      '5008':
        'Menet közben 14,6–14,8 V, indítás után azonnal tölt. Start-stop leállásnál 12,0–12,9 V: rendben, a 12,0 V az alsó szélén van.',
      '508':
        'Első indítás után kb. 35 mp-ig 10,2 V volt járó motorral, utána 14,2 V. A késleltetett töltés PSA-nál normális, de a 10,2 V alacsony: akkuteszt javasolt.',
    },
  },
  {
    id: 'boostReq',
    label: 'Kért töltőnyomás',
    unit: 'mbar',
    decimals: 0,
    status: 'identified',
    source: { kind: 'zone', zone: 'CA', bytes: '6–7', decode: u16(6) },
    range: [800, 2800],
    description:
      'A motorvezérlő által kért (abszolút) töltőnyomás. Gyári zóna 21CA, 6–7. bájt, mbar = nyers. Az OBDb lista ugyanígy kódolja.',
    optimal: 'Alapjáraton pontosan 1000 mbar (légköri), terhelés alatt 2600 mbar-ig nő.',
    cars: {
      '5008': 'Az 5008-on is igazolva, ugyanebben a bájtban. A mért érték 0–30 mbarral követi.',
      '508': 'Alapjáraton 1000 mbar, terhelésnél 2600 mbar-ig. Itt azonosítottuk először.',
    },
  },
  {
    id: 'boostAct',
    label: 'Mért töltőnyomás',
    unit: 'mbar',
    decimals: 0,
    status: 'identified',
    source: { kind: 'zone', zone: 'CA', bytes: '8–9', decode: u16(8) },
    range: [800, 2800],
    description:
      'A szívócsőben mért (abszolút) töltőnyomás. Gyári zóna 21CA, 8–9. bájt, mbar = nyers. Együtt mozog a szabványos szívócsőnyomással (010B).',
    optimal:
      'Kövesse a kért értéket 0–50 mbarral. Terhelés alatt 500 mbar-nál nagyobb elmaradás szivárgásra utal (P0299), tartósan a kért fölött túltöltés (P0234).',
    cars: {
      '5008':
        'Normálisan 0–30 mbarral követi a kértet, max. 2530 mbar. Egy úton (2026-11-01 18:07) 350–400 mbarral a kért fölött volt: átmeneti helyettesítő üzemmód. Hidegen a szívócső-fojtás miatt alapjáraton 730–760 mbar.',
      '508': 'Átlagosan 35 mbarral a kért alatt, nagyobb elmaradás csak gyorsításkor: rendben.',
    },
  },
  {
    id: 'boostDiff',
    label: 'Töltőnyomás eltérés (mért − kért)',
    unit: 'mbar',
    decimals: 0,
    status: 'identified',
    source: {
      kind: 'zone',
      zone: 'CA',
      bytes: '6–9',
      decode: (b) => (b.length > 9 ? b[8] * 256 + b[9] - (b[6] * 256 + b[7]) : null),
    },
    range: [-800, 800],
    ok: [-150, 150],
    description:
      'A mért és a kért töltőnyomás különbsége (21CA b8–9 mínusz b6–7). Ebből látszik leggyorsabban a turbó vagy a szívóoldal hibája.',
    optimal:
      'Egyenletes haladásnál ±50 mbar, gyorsításkor rövid ideig −300 mbar is lehet. Tartósan −500 mbar alatt szivárgás (P0299), tartósan +300 mbar fölött túltöltés (P0234).',
    cars: {
      '5008':
        'Normálisan 0 és +30 mbar között. A 2026-11-01-i helyettesítő üzemmódban +350…+400 mbar volt. Hidegen és leálláskor a fojtás miatt negatív, az normális.',
      '508': 'Átlagosan −35 mbar: rendben.',
    },
  },
  {
    id: 'load',
    label: 'Motorterhelés',
    unit: '%',
    decimals: 0,
    status: 'identified',
    source: { kind: 'pid', pid: '04' },
    range: [0, 100],
    description: 'Számított motorterhelés a maximális nyomatékhoz képest (szabványos OBD, 0104).',
    optimal: 'Alapjáraton 15–25 %, egyenletes haladásnál 30–50 %, gyorsításkor 100 %-ig.',
    cars: {
      '5008': '110 km/h-nál 43 %, 124 km/h-nál 53 %: a nagyobb, nehezebb autó miatt több, mint a 508-é.',
      '508': '110 km/h körül 31 %.',
    },
  },
  {
    id: 'map',
    label: 'Szívócső nyomás',
    unit: 'kPa',
    decimals: 0,
    status: 'identified',
    source: { kind: 'pid', pid: '0B' },
    range: [20, 260],
    description: 'Abszolút nyomás a szívócsőben (szabványos OBD, 010B). 100 kPa = légköri.',
    optimal: 'Meleg motor alapjáratán kb. 100 kPa, terhelés alatt 240–260 kPa-ig.',
    cars: {
      '5008':
        'Meleg motorral alapjáraton 101 kPa. Hidegen 70–77 kPa (szívócső-fojtás, melegítési stratégia), megálláskor és start-stop leállásnál 29–31 kPa (rázkódásgátló zárás): ezek normálisak.',
      '508': 'Mért 100–239 kPa.',
    },
  },
  {
    id: 'maf',
    label: 'Légtömegmérő',
    unit: 'g/s',
    decimals: 1,
    status: 'identified',
    source: { kind: 'pid', pid: '10' },
    range: [0, 120],
    description: 'A motorba beszívott levegő tömegárama (szabványos OBD, 0110).',
    optimal: 'Alapjáraton 5–10 g/s, 110 km/h-nál kb. 30–40 g/s, teljes gázon 100 g/s fölött.',
    cars: {
      '5008':
        '110 km/h-nál kb. 34 g/s. A 2026-11-01-i helyettesítő üzemmódban 57 g/s volt (valószínűleg zárt EGR).',
      '508': 'Egyenletes haladásnál kevesebb levegő kell, mint az 5008-nak.',
    },
  },
  {
    id: 'iat',
    label: 'Szívott levegő hőmérséklet',
    unit: '°C',
    decimals: 0,
    status: 'identified',
    source: { kind: 'pid', pid: '0F' },
    range: [-20, 80],
    ok: [-20, 45],
    description: 'A beszívott levegő hőmérséklete (szabványos OBD, 010F).',
    optimal: 'A külső hőmérséklet körül, menet közben 5–20 °C-kal fölötte. 60 °C fölött a teljesítmény csökken.',
    cars: {
      '5008': 'Hideg reggelen 7–10 °C volt.',
      '508': 'Nincs eltérés a szokásostól.',
    },
  },
  {
    id: 'lambda',
    label: 'Lambda',
    unit: 'λ',
    decimals: 2,
    status: 'identified',
    source: { kind: 'pid', pid: '34', fallback: '24' },
    range: [0.8, 2.1],
    description: 'A szélessávú lambdaszonda szerinti levegő–üzemanyag arány (szabványos OBD, 0134 vagy 0124).',
    optimal:
      'Dízelnél 1,2–2,0 fölött, a 2,00 a mérési határ (normális). Indulás után 1–4 percig 1,00–1,04, amíg a szonda bemelegszik.',
    cars: {
      '5008':
        'Normális. Egy 65 mp-es leállás után 3 percig 1,03 volt (a szonda újramelegedett). A 2026-11-01-i úton végig 1,02-n állt: helyettesítő üzemmód, hibakód-kiolvasás javasolt.',
      '508': 'Az első 1–2 percben 1,00, utána 2,0: normális.',
    },
  },
  {
    id: 'lambdaReq',
    label: 'Kért lambda',
    unit: 'λ',
    decimals: 2,
    status: 'identified',
    source: { kind: 'pid', pid: '44' },
    range: [0.8, 2.1],
    description: 'A motorvezérlő által kért levegő–üzemanyag arány (szabványos OBD, 0144).',
    optimal: 'Dízelnél gyakran állandó 1,00 (nem használja szabályozásra).',
    cars: { '5008': 'Nincs külön megfigyelés.', '508': 'Nincs külön megfigyelés.' },
  },
  {
    id: 'fuel',
    label: 'Üzemanyagszint',
    unit: '%',
    decimals: 0,
    status: 'identified',
    source: { kind: 'pid', pid: '2F' },
    range: [0, 100],
    ok: [15, 100],
    description: 'Az üzemanyagtartály szintje (szabványos OBD, 012F), ha az autó megadja.',
    optimal: '15 % fölött. A FAP adalék (Eolys) a tankolásnál adagolódik, 10 liternél nagyobb tankolásnál.',
    cars: { '5008': 'Nincs külön megfigyelés.', '508': 'Nincs külön megfigyelés.' },
  },
  {
    id: 'ecuVoltage',
    label: 'ECU feszültség',
    unit: 'V',
    decimals: 1,
    status: 'identified',
    source: { kind: 'pid', pid: '42' },
    range: [10, 16],
    ok: [12.4, 14.8],
    description: 'A motorvezérlő tápfeszültsége (szabványos OBD, 0142).',
    optimal: 'Járó motorral 13,8–14,8 V, álló motorral 12,4–12,8 V.',
    cars: {
      '5008': 'Ugyanazt mutatja, mint az akkumulátor feszültség.',
      '508': 'Ugyanazt mutatja, mint az akkumulátor feszültség (lásd ott a 10,2 V-os esést).',
    },
  },
  {
    id: 'catIn',
    label: 'Katalizátor hőmérséklet (előtte)',
    unit: '°C',
    decimals: 0,
    status: 'identified',
    source: { kind: 'pid', pid: '3C' },
    range: [0, 800],
    ok: [200, 650],
    description: 'A katalizátor előtti hőmérséklet (szabványos OBD, 013C), ha az autó megadja.',
    optimal: 'Menet közben 200–500 °C, regeneráláskor 600 °C fölött is lehet.',
    cars: {
      '5008': 'A 2011-es dízeleken ritkán támogatott, csak akkor jelenik meg, ha az autó válaszol.',
      '508': 'A 2011-es dízeleken ritkán támogatott, csak akkor jelenik meg, ha az autó válaszol.',
    },
  },
  {
    id: 'catOut',
    label: 'Katalizátor hőmérséklet (utána)',
    unit: '°C',
    decimals: 0,
    status: 'identified',
    source: { kind: 'pid', pid: '3E' },
    range: [0, 800],
    ok: [200, 650],
    description: 'A katalizátor utáni hőmérséklet (szabványos OBD, 013E), ha az autó megadja.',
    optimal: 'Menet közben 200–500 °C, regeneráláskor 600 °C fölött is lehet.',
    cars: {
      '5008': 'Csak akkor jelenik meg, ha az autó válaszol rá.',
      '508': 'Csak akkor jelenik meg, ha az autó válaszol rá.',
    },
  },
  {
    id: 'dpfTempStd',
    label: 'DPF hőmérséklet (szabványos)',
    unit: '°C',
    decimals: 0,
    status: 'identified',
    source: { kind: 'pid', pid: '7C' },
    range: [0, 800],
    ok: [150, 600],
    description: 'A részecskeszűrő előtti hőmérséklet (szabványos OBD, 017C), ha az autó megadja.',
    optimal: 'Menet közben 200–450 °C, regeneráláskor 450–600 °C fölött.',
    cars: {
      '5008': 'A 2011-es autón valószínűleg nincs, ezért a gyári kipufogó-hőfok jelöltet nézd.',
      '508': 'A 2011-es autón valószínűleg nincs, ezért a gyári kipufogó-hőfok jelöltet nézd.',
    },
  },
  {
    id: 'egtStd',
    label: 'Kipufogógáz hőmérséklet (szabványos)',
    unit: '°C',
    decimals: 0,
    status: 'identified',
    source: { kind: 'pid', pid: '78' },
    range: [0, 800],
    ok: [150, 600],
    description: 'Kipufogógáz-hőmérséklet (szabványos OBD, 0178), ha az autó megadja.',
    optimal: 'Menet közben 200–450 °C, regeneráláskor 450–600 °C fölött.',
    cars: {
      '5008': 'Csak akkor jelenik meg, ha az autó válaszol rá.',
      '508': 'A szabványos csatornán nem adja (mérve).',
    },
  },
  {
    id: 'dpfDpStd',
    label: 'DPF nyomáskülönbség (szabványos)',
    unit: 'mbar',
    decimals: 0,
    status: 'identified',
    source: { kind: 'pid', pid: '7A' },
    range: [0, 250],
    ok: [0, 100],
    description: 'A részecskeszűrő előtti és utáni nyomás különbsége (szabványos OBD, 017A), ha az autó megadja.',
    optimal: 'Alapjáraton 0–5 mbar, 20 mbar fölött eltömődés vagy hamu gyanú. 200 mbar fölött hiba.',
    cars: {
      '5008': 'Csak akkor jelenik meg, ha az autó válaszol rá. A gyári jelöltet lásd lent.',
      '508': 'Csak akkor jelenik meg, ha az autó válaszol rá. A gyári jelöltet lásd lent.',
    },
  },

  // 🟡 Kérdéses -----------------------------------------------------------------------------
  {
    id: 'soot',
    label: 'Koromtöltöttség-becslés',
    unit: '',
    decimals: 0,
    status: 'questionable',
    source: { kind: 'zone', zone: 'CB', bytes: '9–10', decode: (b) => (b.length > 10 ? (b[9] & 0x0f) * 256 + b[10] : null) },
    range: [0, 2500],
    description:
      'A motorvezérlő becsült koromterhelése a részecskeszűrőben (jelölt). Gyári zóna 21CB, (b9 & 0x0F)·256 + b10, egysége ismeretlen. Városban nő, hosszabb autópályás szakaszon csökken.',
    optimal:
      'Regenerálás után 0 körül, utána km-rel nő. Gyári küszöb nem ismert; regeneráláskor (450–600 °C-os kipufogó) gyorsan le kell esnie.',
    cars: {
      '5008':
        '⚠️ Öt nap alatt 448-ról 1972-re nőtt (sok rövid, hideg út), regenerálás nem volt. Egyszer 420 °C-os autópályán egy óra alatt 287 → 0 esett. Javaslat: 20–30 perc egyfolytában 100–120 km/h, rögzítéssel.',
      '508':
        'Mért 147 → 253. Itt a b9 felső 4 bitje állandóan 0x5, ezért csak az alsó 4 bit számít (maszkolva).',
    },
  },
  {
    id: 'dpfDp',
    label: 'DPF nyomáskülönbség (jelölt)',
    unit: 'mbar?',
    decimals: 0,
    status: 'questionable',
    source: { kind: 'zone', zone: 'CB', bytes: '16', decode: u8(16) },
    range: [0, 220],
    ok: [0, 80],
    description:
      'A részecskeszűrő ellennyomása (jelölt). Gyári zóna 21CB, 16. bájt, nyers érték, egysége valószínűleg mbar. Mindkét autón a légtömeggel együtt nő.',
    optimal:
      'Álló autó alapjáratán 0–5. 20 fölött alapjáraton eltömődés vagy hamutelítettség gyanú. Menet közben a légtömeggel arányosan nő.',
    cars: {
      '5008':
        '⚠️ Alapjárat 0–5, város 0–48, 110 km/h 65–75, 135 km/h 190–200. Azonos légtömegnél kb. 6× a 508-é. Mivel a korom közben 0-ra esett, ez nem: inkább hamu / lerakódott adalék a 300 000+ km-es szűrőben. Eolys szint és P1445 ellenőrzése javasolt.',
      '508': '1 g/s légtömegre kb. 0,3 jut, jóval kisebb, mint az 5008-é: a szűrő valószínűleg újabb.',
    },
  },
  {
    id: 'egt',
    label: 'Kipufogó-hőmérséklet (jelölt)',
    unit: '°C',
    decimals: 0,
    status: 'questionable',
    source: { kind: 'zone', zone: 'CB', bytes: '23–24', decode: u16(23) },
    range: [0, 700],
    ok: [150, 600],
    description:
      'Kipufogó- vagy DPF-hőmérséklet (jelölt). Gyári zóna 21CB, 23–24. bájt, °C = nyers. A 25–26. bájt legfeljebb 1 °C-kal tér el, tehát valószínűleg ugyanaz az érzékelő.',
    optimal: 'Városban 200–300 °C, autópályán 300–450 °C. Regeneráláskor 450–600 °C fölé megy, ebből látszik a regenerálás.',
    cars: {
      '5008': '110 km/h-nál 420 °C, max. 464 °C, városban 219–301 °C. Regenerálás közbeni értéket még nem mértünk.',
      '508': 'Indításkor 85, alapjáraton 145–190, 100 km/h-nál 280, max. kb. 330 °C.',
    },
  },
  {
    id: 'distSince',
    label: 'km a legutóbbi tankolás (vagy regenerálás) óta',
    unit: 'km',
    decimals: 0,
    status: 'questionable',
    source: { kind: 'zone', zone: 'CB', bytes: '28–29', decode: u16(28) },
    description:
      'Kilométer-számláló (jelölt). Gyári zóna 21CB, 28–29. bájt, km = nyers. Együtt nő a hosszú számlálóval.',
    optimal:
      'Nincs optimális érték. Ha tankolás után nullázódik, „km tankolás óta” (az Eolys adagolás figyeli). Ha regeneráláskor, akkor „km regenerálás óta” (400–500 km-enként várható).',
    cars: {
      '5008':
        '520 km-en pontosan egyezett a fedélzeti computer „1” távolságával, ezért a legvalószínűbb: km a legutóbbi tankolás óta. 2026-11-04-én 631 km, nem nullázódott.',
      '508': '45 → 58 → 71, mindkét úton annyit nőtt, amennyit az autó ment.',
    },
  },
  {
    id: 'longKm',
    label: 'Hosszú km-számláló (nem a km-óra)',
    unit: 'km',
    decimals: 0,
    status: 'questionable',
    source: { kind: 'zone', zone: 'CB', bytes: '34–36', decode: u24(34) },
    description:
      'Hosszú kilométer-számláló. Gyári zóna 21CB, 34–36. bájt, km = nyers, kb. 8 km-enként frissül. A számláló biztos, de nem a kilométeróra, a jelentése ismeretlen.',
    optimal: 'Nincs optimális érték. Lehet: km a FAP cseréje, az adalékrendszer nullázása vagy a vezérlő beszerelése óta.',
    cars: {
      '5008': 'Km-óra 312 986 km-nél 103 640, tehát kb. 209 350 km-es óraállásnál indult 0-ról (FAP / vezérlő / adalékrendszer csere?).',
      '508': 'Km-óra kb. 290 000 km-nél 108 400.',
    },
  },
  {
    id: 'eventCounter',
    label: 'Eseményszámláló (váltás / üzemanyag-elzárás?)',
    unit: '',
    decimals: 0,
    status: 'questionable',
    source: { kind: 'zone', zone: 'DC', bytes: '18–20', decode: u24(18) },
    description:
      'Élettartam-számláló, csak nő. Gyári zóna 21DC, 18–20. bájt. Gyorsításnál, váltásnál lép, egyenletes autópályán alig, hideg motornál (kb. 75 °C alatt) egyáltalán nem.',
    optimal: 'Nincs optimális érték. Egy állva végzett N → 1 → N váltogatás vagy egy motorfékes gurulás eldönti, mit számol.',
    cars: {
      '5008': 'Mért 855 750 → 856 452.',
      '508': 'Mért 586 254 → 586 300.',
    },
  },
  {
    id: 'state',
    label: 'Motor állapotbájt',
    unit: '',
    decimals: 0,
    status: 'questionable',
    source: { kind: 'zone', zone: 'C7', bytes: '7', decode: u8(7) },
    range: [0, 255],
    format: hex,
    description:
      'Üzemállapot bitekben (jelölt). Gyári zóna 21C7, 7. bájt (ugyanez a 21CC b3 és a 21CE b7). 0x10 bit = terhelés, 0x06 = álló autó.',
    optimal: '0xA6 álló autó, 0xA0 gurulás, 0xB0 terhelés. A 0x20 bit hiánya (pl. 0x80) helyettesítő üzemmódra utalhat.',
    cars: {
      '5008': 'A 2026-11-01-i helyettesítő üzemmódban a 0x20 bit törlődött (0x80).',
      '508': 'A fenti értékeket mutatja.',
    },
  },
  {
    id: 'throttle',
    label: 'Szívócső-fojtás zárása',
    unit: '%',
    decimals: 0,
    status: 'questionable',
    source: { kind: 'pid', pid: '11' },
    range: [0, 100],
    description:
      'A szabványos „fojtószelep” PID (0111). Dízelen nincs gázpedálos fojtószelep, ez valószínűleg a szívócső-fojtás zárásának mértéke.',
    optimal: 'Meleg motorral kb. 13 % (nyitva). Hidegen 70–87 % (melegítési stratégia), leálláskor 85–87 % (rázkódásgátló zárás).',
    cars: {
      '5008': 'Hidegen 70–87 % kb. 69–74 °C-ig, utána 13 %. Megálláskor és start-stop leállásnál 85–87 %: normális.',
      '508': 'Nincs külön megfigyelés.',
    },
  },
  {
    id: 'warmupFlag',
    label: 'Bemelegedés jelző',
    unit: '',
    decimals: 0,
    status: 'questionable',
    source: { kind: 'zone', zone: 'CB', bytes: '27', decode: u8(27) },
    range: [0, 32],
    description: 'Állapotjelző (jelölt). Gyári zóna 21CB, 27. bájt. Indulás után 0, kb. 4 perc múlva 16 és úgy marad.',
    optimal: 'Meleg motornál 16. Hidegindításos napló dönti el, hogy tényleg a bemelegedés vége-e.',
    cars: { '5008': 'Nincs külön megfigyelés.', '508': 'Az első naplókban kb. 4 perc után 0 → 16.' },
  },

  // ❓ Nem azonosított ----------------------------------------------------------------------
  {
    id: 'cc45',
    label: '21CC bájt 4–5',
    unit: 'nyers',
    decimals: 0,
    status: 'unidentified',
    source: { kind: 'zone', zone: 'CC', bytes: '4–5', decode: u16(4) },
    description: 'Ötlet: levegőtömeg- vagy nyomaték-alapjel. Alapjáraton pont 400, terhelésnél 2266-ig nő.',
    optimal: 'Nem ismert.',
    cars: { '5008': 'Nincs külön megfigyelés.', '508': 'Alapjáraton 400, terhelésnél 2266.' },
  },
  {
    id: 'cc67',
    label: '21CC bájt 6–7',
    unit: 'nyers',
    decimals: 0,
    status: 'unidentified',
    source: { kind: 'zone', zone: 'CC', bytes: '6–7', decode: u16(6) },
    description: 'Mindig a 21CC b4–5 fele (alapjáraton 200, terhelésnél 1143). Ötlet: levegőtömeg-alapjel (OBDb: Air flow target).',
    optimal: 'Nem ismert.',
    cars: { '5008': 'Nincs külön megfigyelés.', '508': 'Alapjáraton 200, terhelésnél 1143.' },
  },
  {
    id: 'ca3738',
    label: '21CA bájt 37–38',
    unit: 'nyers',
    decimals: 0,
    status: 'unidentified',
    source: { kind: 'zone', zone: 'CA', bytes: '37–38', decode: u16(37) },
    description: 'A töltőnyomással mozog (348–1001). Ötlet: turbólapát (VGT) helyzet vagy kitöltés, /10 = 34,8–100,1 %.',
    optimal: 'Nem ismert. Gázfröccsös napló dönti el.',
    cars: { '5008': 'Nincs külön megfigyelés.', '508': '348–1001.' },
  },
  {
    id: 'ca3940',
    label: '21CA bájt 39–40',
    unit: 'nyers',
    decimals: 0,
    status: 'unidentified',
    source: { kind: 'zone', zone: 'CA', bytes: '39–40', decode: u16(39) },
    description: 'A töltőnyomással mozog, a 37–38. bájt párja. Ötlet: turbó vagy EGR szabályozás.',
    optimal: 'Nem ismert.',
    cars: { '5008': 'Nincs külön megfigyelés.', '508': 'Nincs külön megfigyelés.' },
  },
  {
    id: 'cd10',
    label: '21CD bájt 10',
    unit: 'nyers',
    decimals: 0,
    status: 'unidentified',
    source: { kind: 'zone', zone: 'CD', bytes: '10', decode: u8(10) },
    description: 'A lambdával ellentétesen mozog. Ötlet: befecskendezett üzemanyag-mennyiség (motorféknél 0-ra kellene esnie).',
    optimal: 'Nem ismert. Motorfékes napló dönti el.',
    cars: { '5008': 'Nincs külön megfigyelés.', '508': 'Nincs külön megfigyelés.' },
  },
  {
    id: 'cb4',
    label: '21CB bájt 4',
    unit: 'nyers',
    decimals: 0,
    status: 'unidentified',
    source: { kind: 'zone', zone: 'CB', bytes: '4', decode: u8(4) },
    description: 'A 21CB b4–8 csoport első bájtja: alapjáraton és motorféknél teljesen eltér. Ötlet: EGR vagy lambda szabályozás.',
    optimal: 'Nem ismert.',
    cars: {
      '5008': 'A 2026-11-01-i helyettesítő üzemmódban alapjárati értéken állt.',
      '508': 'Nincs külön megfigyelés.',
    },
  },
  {
    id: 'ca2021',
    label: '21CA bájt 20–21',
    unit: 'nyers',
    decimals: 0,
    status: 'unidentified',
    source: { kind: 'zone', zone: 'CA', bytes: '20–21', decode: u16(20) },
    description: 'Normálisan 15–16.',
    optimal: 'Nem ismert.',
    cars: { '5008': 'A 2026-11-01-i helyettesítő üzemmódban 0 volt.', '508': 'Nincs külön megfigyelés.' },
  },
  {
    id: 'cb32',
    label: '21CB bájt 32',
    unit: 'nyers',
    decimals: 0,
    status: 'unidentified',
    source: { kind: 'zone', zone: 'CB', bytes: '32', decode: u8(32) },
    description: 'Alapjáraton 0, egyenletes haladásnál 100.',
    optimal: 'Nem ismert.',
    cars: { '5008': 'Nincs külön megfigyelés.', '508': 'Nincs külön megfigyelés.' },
  },
  {
    id: 'cb33',
    label: '21CB bájt 33',
    unit: 'nyers',
    decimals: 0,
    status: 'unidentified',
    source: { kind: 'zone', zone: 'CB', bytes: '33', decode: u8(33) },
    description: 'Lépcsőkben változik.',
    optimal: 'Nem ismert.',
    cars: { '5008': '45 → 54 → 62 lépcsőkben.', '508': '40, állandó.' },
  },
];

export const STATUS_ORDER: ParamStatus[] = ['identified', 'questionable', 'unidentified'];

export const PARAM_BY_ID: Record<string, Param> = Object.fromEntries(PARAMS.map((p) => [p.id, p]));

/** A paraméter forrásának rövid leírása a részletes nézethez. */
export function sourceText(param: Param): string {
  const s = param.source;
  if (s.kind === 'battery') return 'Adapter feszültségmérése (ATRV)';
  if (s.kind === 'pid') return `Szabványos OBD, PID 01${s.pid}${s.fallback ? ` (vagy 01${s.fallback})` : ''}`;
  return `Motorvezérlő gyári zóna 21${s.zone}, bájt ${s.bytes} (6A8/688)`;
}

export function formatValue(param: Param, value: number | null | undefined): string {
  if (value == null) return '–';
  if (param.format) return param.format(value);
  return value.toFixed(param.decimals);
}
