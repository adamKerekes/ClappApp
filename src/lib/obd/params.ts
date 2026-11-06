import type { CarId } from './cars';

/**
 * Az élő paraméterlista: minden kijelzett érték leírása, honnan jön, milyen tartományban
 * kell mutatni, és mit jelent a két autón. A tartalom a projekt tudásbázisából
 * (`clapp/tudasbazis.md`) és a naplóelemzésekből (`clapp/elemzes/`) származik.
 *
 * Bizonyosság (a tudásbázis jelöléseivel):
 * - `identified`: ✅ autón mért adatból igazolva, szabványos OBD érték, vagy a FAP / FAP Lite app
 *   (SID807 profil) paramétertáblájából (`clapp/elemzes/faplite-apk-vizsgalat-2026-11-06.md`,
 *   `clapp/elemzes/fap-teljes-apk-vizsgalat-2026-11-06.md`).
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
  identified:
    'Egyértelműen azonosított: autón mért adatból igazolva, szabványos OBD érték, vagy a FAP / FAP Lite app gyári paramétertáblája (SID807 profil) szerint.',
  questionable:
    'Kérdéses: a viselkedése illik a jelentésre, de még nincs igazolva (pl. regenerálás kell hozzá). A név és a mértékegység tévedhet.',
  unidentified:
    'Nem azonosított: folyamatosan változó gyári adat, aminek a jelentése még nem ismert. Nyers számot mutat, a naplóba a visszafejtéshez kerül be.',
};

/** Gyári zóna (motorvezérlő 6A8/688, `21xx`), hexában a `21` nélkül. */
export type ZoneId = 'CA' | 'CB' | 'C7' | 'C9' | 'CC' | 'CD' | 'DC';

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
    // A 0 is normál: start-stop leállás (5008) vagy álló motor.
    ok: [0, 3500],
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
      '5008': 'A 2011-es autón valószínűleg nincs, ezért a gyári FAP hőmérsékletet nézd.',
      '508': 'A 2011-es autón valószínűleg nincs, ezért a gyári FAP hőmérsékletet nézd.',
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
      '5008': 'Csak akkor jelenik meg, ha az autó válaszol rá. A gyári értéket (21CB b15–16) lásd lent.',
      '508': 'Csak akkor jelenik meg, ha az autó válaszol rá. A gyári értéket (21CB b15–16) lásd lent.',
    },
  },

  // ✅ Gyári zónák, a FAP Lite app paramétertáblája szerint (SID807 profil) --------------
  {
    id: 'fapKm',
    label: 'FAP-pal megtett km',
    unit: 'km',
    decimals: 0,
    status: 'identified',
    source: { kind: 'zone', zone: 'CB', bytes: '34–36', decode: u24(34) },
    description:
      'A jelenlegi részecskeszűrővel (FAP) megtett kilométer. Gyári zóna 21CB, 34–36. bájt, km = nyers, kb. 8 km-enként frissül. A FAP Lite app (SID807 profil) így nevezi, és a viselkedése (1 egység = 1 km, nem a km-óra) mindkét autón illik rá.',
    optimal:
      'Nincs optimális érték. A szűrő élettartama a hamutelítettségtől függ, általában 120 000–180 000 km; FAP-cserénél nullázni kell.',
    cars: {
      '5008': 'Km-óra 312 986 km-nél 103 640, tehát kb. 209 350 km-es óraállásnál volt FAP-csere (vagy nullázás).',
      '508': 'Km-óra 296 900 km-nél kb. 108 460, tehát kb. 188 400 km-es óraállásnál volt FAP-csere (vagy nullázás).',
    },
  },
  {
    id: 'fapAsh',
    label: 'FAP hamutelítettség',
    unit: '%',
    decimals: 0,
    status: 'identified',
    source: { kind: 'zone', zone: 'CB', bytes: '11', decode: u8(11) },
    range: [0, 100],
    ok: [0, 80],
    description:
      'A részecskeszűrőben lerakódott, regenerálással el nem égethető hamu (főleg Eolys adalék és olajhamu) becsült aránya. Gyári zóna 21CB, 11. bájt, % = nyers (FAP Lite, SID807 profil). Ez a vezérlő becslése, nem mérés.',
    optimal: 'Minél kisebb. 100 %-nál a szűrő cserére vagy tisztításra szorul; a korommal ellentétben regeneráláskor nem csökken.',
    cars: {
      '5008': '52 % (0x34). A nagy DPF nyomáskülönbséget ez önmagában nem magyarázza, ellenőrizni kell.',
      '508': '67 % (0x43).',
    },
  },
  {
    id: 'eolysTank',
    label: 'Eolys tartály térfogata',
    unit: 'mL',
    decimals: 0,
    status: 'identified',
    source: { kind: 'zone', zone: 'CB', bytes: '17–18', decode: u16(17) },
    description:
      'Az adaléktartályban a legutóbbi feltöltéskor (nullázáskor) beállított adalékmennyiség. Gyári zóna 21CB, 17–18. bájt, mL = nyers (FAP Lite, SID807 profil).',
    optimal: 'Állandó, csak adalék-feltöltés és Diagbox-nullázás után változik.',
    cars: { '5008': '1020 mL.', '508': '1220 mL.' },
  },
  {
    id: 'eolysLeft',
    label: 'Maradék Eolys adalék',
    unit: 'mL',
    decimals: 0,
    status: 'identified',
    source: { kind: 'zone', zone: 'CB', bytes: '19–20', decode: u16(19) },
    ok: [100, 5000],
    description:
      'A vezérlő szerint a tartályban maradt FAP adalék (Eolys). Gyári zóna 21CB, 19–20. bájt, mL = nyers (FAP Lite, SID807 profil). Tankoláskor csökken, mert az adalékot az üzemanyaghoz adagolja.',
    optimal: 'Ha elfogy, a regenerálás romlik és a műszerfalon FAP-hiba jelenik meg. Kevés maradéknál utántöltés javasolt.',
    cars: { '5008': '678 → 676 mL.', '508': '1206 mL: a tartály majdnem tele, nemrég tölthették vagy nullázták.' },
  },
  {
    id: 'baro',
    label: 'Légköri nyomás',
    unit: 'mbar',
    decimals: 0,
    status: 'identified',
    source: { kind: 'zone', zone: 'CA', bytes: '10–11', decode: u16(10) },
    range: [900, 1100],
    description:
      'A motorvezérlő légköri nyomás érzékelője. Gyári zóna 21CA, 10–11. bájt, mbar = nyers (FAP Lite, SID807 profil). Ugyanaz a kódolás, mint a mellette lévő töltőnyomásé.',
    optimal: 'Tengerszinten kb. 1013 mbar, magasabban kevesebb. Álló motornál a mért töltőnyomással közel egyezik.',
    cars: { '5008': 'Nincs külön megfigyelés.', '508': 'Nincs külön megfigyelés.' },
  },
  {
    id: 'egrReq',
    label: 'EGR kért helyzet',
    unit: '%',
    decimals: 0,
    status: 'identified',
    source: { kind: 'zone', zone: 'CA', bytes: '20', decode: u8(20) },
    range: [0, 100],
    description:
      'A kipufogógáz-visszavezető (EGR) szelep kért nyitása. Gyári zóna 21CA, 20. bájt, % = nyers (FAP Lite, EDC17C10 / SID807_BR2 profil).',
    optimal: 'Alapjáraton és kis terhelésnél nyitva, nagy terhelésnél zárva. Tartósan 0 helyettesítő üzemmódra utalhat.',
    cars: {
      '5008': 'Normálisan 15–16 %. A 2026-11-01-i helyettesítő üzemmódban 0 volt (EGR letiltva).',
      '508': 'Nincs külön megfigyelés.',
    },
  },
  {
    id: 'egrAct',
    label: 'EGR mért helyzet',
    unit: '%',
    decimals: 0,
    status: 'identified',
    source: { kind: 'zone', zone: 'CA', bytes: '21', decode: u8(21) },
    range: [0, 100],
    description:
      'A kipufogógáz-visszavezető (EGR) szelep mért nyitása. Gyári zóna 21CA, 21. bájt, % = nyers (FAP Lite, EDC17C10 / SID807_BR2 profil).',
    optimal: 'Kövesse a kért helyzetet néhány %-on belül. Tartós eltérés kormos, beragadt szelepre utal.',
    cars: {
      '5008': 'Normálisan 15–16 %. A 2026-11-01-i helyettesítő üzemmódban 0 volt.',
      '508': 'Nincs külön megfigyelés.',
    },
  },
  {
    id: 'airMassReq',
    label: 'Kért levegőtömeg',
    unit: 'mg/löket',
    decimals: 0,
    status: 'identified',
    source: { kind: 'zone', zone: 'CA', bytes: '36–37', decode: u16(36) },
    range: [0, 1200],
    description:
      'A motorvezérlő által löketenként kért levegőmennyiség. Gyári zóna 21CA, 36–37. bájt, mg/löket = nyers (FAP Lite, SID807 profil). Korábban 1 bájttal elcsúszva „turbólapát-helyzet” jelöltként olvastuk.',
    optimal: 'Alapjáraton néhány száz mg/löket, terhelésnél 1000 fölé nő. A mért értékkel együtt kell mozognia.',
    cars: { '5008': 'Nincs külön megfigyelés.', '508': 'Nincs külön megfigyelés.' },
  },
  {
    id: 'airMassAct',
    label: 'Mért levegőtömeg',
    unit: 'mg/löket',
    decimals: 0,
    status: 'identified',
    source: { kind: 'zone', zone: 'CA', bytes: '38–39', decode: u16(38) },
    range: [0, 1200],
    description:
      'A légtömegmérő szerint löketenként beszívott levegő. Gyári zóna 21CA, 38–39. bájt, mg/löket = nyers (FAP Lite, SID807 profil).',
    optimal: 'Kövesse a kért értéket. Tartósan a kért alatt: szívóoldali szivárgás vagy hibás légtömegmérő; nyitott EGR-nél kisebb.',
    cars: { '5008': 'Nincs külön megfigyelés.', '508': 'Nincs külön megfigyelés.' },
  },
  {
    id: 'pedal',
    label: 'Gázpedál állása',
    unit: '%',
    decimals: 0,
    status: 'identified',
    source: { kind: 'zone', zone: 'CC', bytes: '8', decode: u8(8) },
    range: [0, 100],
    description: 'A gázpedál lenyomása. Gyári zóna 21CC, 8. bájt, % = nyers (FAP Lite, SID807 profil).',
    optimal: 'Felengedve 0 %, padlógázon 100 %.',
    cars: { '5008': 'Nincs külön megfigyelés.', '508': 'Nincs külön megfigyelés.' },
  },
  {
    id: 'brake',
    label: 'Fékpedál',
    unit: '',
    decimals: 0,
    status: 'identified',
    source: { kind: 'zone', zone: 'CC', bytes: '3', decode: (b) => (b.length > 3 ? ((b[3] & 0x06) === 0x06 ? 1 : 0) : null) },
    range: [0, 1],
    format: (v) => (v ? 'lenyomva' : 'felengedve'),
    description:
      'A fékpedál kapcsolója. Gyári zóna 21CC, 3. bájt, 0x06 bitek (FAP Lite, SID807 profil). 1 = lenyomva, 0 = felengedve. Ugyanez a bájt a motor állapotbájtja.',
    optimal: 'Fékezéskor és álló autónál (fékre lépve) 1.',
    cars: {
      '5008': 'Az állapotbájt 0xA6 értéke (álló autó) a lenyomott fék.',
      '508': 'Az állapotbájt 0xA6 értéke (álló autó) a lenyomott fék.',
    },
  },
  {
    id: 'ecuBattery',
    label: 'Akkufeszültség (motorvezérlő)',
    unit: 'V',
    decimals: 1,
    status: 'identified',
    source: { kind: 'zone', zone: 'CC', bytes: '15', decode: (b) => (b.length > 15 ? b[15] / 10 : null) },
    range: [10, 16],
    ok: [12.4, 14.8],
    description:
      'Az akkumulátor feszültsége a motorvezérlő szerint. Gyári zóna 21CC, 15. bájt, V = nyers / 10 (FAP Lite, SID807 profil). Az adapter (ATRV) mérésével össze lehet vetni.',
    optimal: 'Járó motorral 13,8–14,8 V, álló motorral 12,4–12,8 V.',
    cars: {
      '5008': 'Az adapter szerint menet közben 14,6–14,8 V, start-stop leállásnál 12,0–12,9 V.',
      '508': 'Az adapter szerint első indítás után kb. 35 mp-ig 10,2 V, utána 14,2 V.',
    },
  },

  // ✅ Gyári zónák, a teljes FAP app paramétertáblája szerint (SID807 profil) -----------
  {
    id: 'soot',
    label: 'Koromtömeg',
    unit: 'g/l',
    decimals: 2,
    status: 'identified',
    source: {
      kind: 'zone',
      zone: 'CB',
      bytes: '9–10',
      decode: (b) => (b.length > 10 ? ((b[9] & 0x0f) * 256 + b[10]) / 1000 : null),
    },
    range: [0, 6],
    ok: [0, 3],
    description:
      'A motorvezérlő becsült koromterhelése a részecskeszűrőben. Gyári zóna 21CB, 9–10. bájt, g/l = nyers · 0,001 (FAP app, SID807 profil, max. 6 g/l). A b9 felső 4 bitje nem korom, ezért maszkoljuk. Városban nő, regeneráláskor gyorsan leesik.',
    optimal:
      'Regenerálás után 0 körül, utána km-rel nő. A regenerálás jellemzően 2–3 g/l körül indul; ha ennél jóval magasabb és nem esik vissza, hosszabb 90+ km/h-s út vagy szerviz kell.',
    cars: {
      '5008':
        '⚠️ Öt nap alatt 0,45-ről 2,6 g/l-re nőtt (sok rövid, hideg út), regenerálás nem volt. Egyszer 420 °C-os autópályán egy óra alatt 0,29 → 0 esett. Javaslat: 20–30 perc egyfolytában 100–120 km/h, rögzítéssel, a „Regenerálás fut” jelzőt figyelve.',
      '508': 'Mért 0,15 → 0,6 g/l. Itt a b9 felső 4 bitje állandóan 0x5, ezt maszkoljuk.',
    },
  },
  {
    id: 'dpfDp',
    label: 'DPF nyomáskülönbség',
    unit: 'mbar',
    decimals: 0,
    status: 'identified',
    source: { kind: 'zone', zone: 'CB', bytes: '15–16', decode: u16(15) },
    range: [0, 220],
    ok: [0, 80],
    description:
      'A részecskeszűrő előtti és utáni nyomás különbsége. Gyári zóna 21CB, 15–16. bájt, mbar = nyers (FAP app, SID807 profil). A légtömeggel együtt nő.',
    optimal:
      'Álló autó alapjáratán 0–5 mbar. Alapjáraton 20 fölött eltömődés vagy hamutelítettség gyanú. Menet közben a légtömeggel arányosan nő.',
    cars: {
      '5008':
        '⚠️ Alapjárat 3–14, 100+ km/h 23–75, 135 km/h 190–200 mbar. Azonos légtömegnél kb. 6× a 508-é: inkább hamu / lerakódott adalék a 300 000+ km-es autó szűrőjében. Eolys szint és P1445 ellenőrzése javasolt.',
      '508': '1 g/s légtömegre kb. 0,3 mbar jut, jóval kisebb, mint az 5008-é.',
    },
  },
  {
    id: 'fapTemp',
    label: 'FAP hőmérséklet',
    unit: '°C',
    decimals: 0,
    status: 'identified',
    source: { kind: 'zone', zone: 'CB', bytes: '25–26', decode: u16(25) },
    range: [0, 700],
    ok: [150, 600],
    description:
      'A részecskeszűrő hőmérséklete. Gyári zóna 21CB, 25–26. bájt, °C = nyers (FAP app, SID807 profil). A 23–24. bájt legfeljebb 1 °C-kal tér el tőle, azt az app nem nevezi meg.',
    optimal: 'Városban 200–300 °C, autópályán 300–450 °C. Regeneráláskor 450–600 °C fölé megy.',
    cars: {
      '5008': '110 km/h-nál 420 °C, max. 464 °C, városban 190–340 °C. Regenerálás közbeni értéket még nem mértünk.',
      '508': 'Indításkor 85, alapjáraton 145–190, 100 km/h-nál 280, max. kb. 330 °C.',
    },
  },
  {
    id: 'regenActive',
    label: 'Regenerálás fut',
    unit: '',
    decimals: 0,
    status: 'identified',
    source: { kind: 'zone', zone: 'CB', bytes: '27', decode: (b) => (b.length > 27 ? (b[27] & 0x04 ? 1 : 0) : null) },
    range: [0, 1],
    format: (v) => (v ? 'igen' : 'nem'),
    description: 'A FAP regenerálás jelzője. Gyári zóna 21CB, 27. bájt, 0x04 bit (FAP app, SID807 profil). 1 = a regenerálás éppen fut.',
    optimal: 'Általában 0. Ha 1, ne állítsd le a motort, amíg vissza nem vált 0-ra (kb. 10–20 perc).',
    cars: {
      '5008': 'Az eddigi naplókban egyszer sem volt 1: regenerálás nem futott.',
      '508': 'Az eddigi naplókban egyszer sem volt 1.',
    },
  },
  {
    id: 'regenHeat',
    label: 'Fűtő fogyasztók (regenerálás-segítés)',
    unit: '',
    decimals: 0,
    status: 'identified',
    source: { kind: 'zone', zone: 'CB', bytes: '27', decode: (b) => (b.length > 27 ? (b[27] & 0x08 ? 1 : 0) : null) },
    range: [0, 1],
    format: (v) => (v ? 'be' : 'ki'),
    description:
      'A regenerálást segítő elektromos fogyasztók (pl. hátsó szélvédő-fűtés) bekapcsolása. Gyári zóna 21CB, 27. bájt, 0x08 bit (FAP app, SID807 profil).',
    optimal: 'Általában 0, regenerálás alatt lehet 1.',
    cars: { '5008': 'Eddig mindig 0.', '508': 'Eddig mindig 0.' },
  },
  {
    id: 'distSince',
    label: 'km a legutóbbi regenerálás óta',
    unit: 'km',
    decimals: 0,
    status: 'identified',
    source: { kind: 'zone', zone: 'CB', bytes: '28–29', decode: u16(28) },
    description: 'A legutóbbi FAP regenerálás óta megtett út. Gyári zóna 21CB, 28–29. bájt, km = nyers (FAP app, SID807 profil).',
    optimal: 'Regenerálás 400–700 km-enként várható, utána 0-ra nullázódik. 700 km fölött a regenerálás késik.',
    cars: {
      '5008': '⚠️ 2026-11-05-én 698 km, nem nullázódott: a regenerálás régóta nem tudott lefutni.',
      '508': '127 km.',
    },
  },
  {
    id: 'regenAvg',
    label: 'Utolsó 10 regenerálás átlagos távja',
    unit: 'km',
    decimals: 0,
    status: 'identified',
    source: { kind: 'zone', zone: 'CB', bytes: '30–31', decode: u16(30) },
    description: 'Az utolsó 10 regenerálás között megtett átlagos távolság. Gyári zóna 21CB, 30–31. bájt, km = nyers (FAP app, SID807 profil).',
    optimal: 'Kb. 400–700 km. Jóval rövidebb átlag sok rövid, hideg útra vagy nagy hamutelítettségre utal.',
    cars: { '5008': 'Nincs külön megfigyelés.', '508': 'Nincs külön megfigyelés.' },
  },
  {
    id: 'additiveDeposit',
    label: 'Lerakódott adalék a FAP-ban',
    unit: 'g',
    decimals: 0,
    status: 'identified',
    source: { kind: 'zone', zone: 'CB', bytes: '21–22', decode: u16(21) },
    description:
      'A részecskeszűrőben lerakódott Eolys adalék becsült tömege. Gyári zóna 21CB, 21–22. bájt, g = nyers (FAP app, SID807 profil, max. 400). Számszerűen megegyezik az Eolys tartály − maradék különbséggel.',
    optimal: 'Csak nő; a FAP cseréjekor vagy tisztításakor nullázzák.',
    cars: { '5008': '342 → 344.', '508': '14.' },
  },
  {
    id: 'iatMaf',
    label: 'Légtömegmérő levegő-hőmérséklet',
    unit: '°C',
    decimals: 0,
    status: 'identified',
    source: { kind: 'zone', zone: 'CA', bytes: '4', decode: (b) => (b.length > 4 ? b[4] - 50 : null) },
    range: [-20, 80],
    description: 'A légtömegmérő hőmérséklet-érzékelője. Gyári zóna 21CA, 4. bájt, °C = nyers − 50 (FAP app, SID807 profil).',
    optimal: 'A külső hőmérséklet körül, menet közben kissé fölötte.',
    cars: {
      '5008': 'Nincs külön megfigyelés.',
      '508': 'A szabványos 010F itt −40 °C-ot mutat (érzékelő- vagy vezetékhiba?): ezzel összevetve kiderül, melyik a hibás.',
    },
  },
  {
    id: 'outsideTemp',
    label: 'Külső hőmérséklet',
    unit: '°C',
    decimals: 0,
    status: 'identified',
    source: { kind: 'zone', zone: 'CA', bytes: '31', decode: (b) => (b.length > 31 ? b[31] - 50 : null) },
    range: [-20, 50],
    description: 'A külső hőmérséklet a motorvezérlő szerint. Gyári zóna 21CA, 31. bájt, °C = nyers − 50 (FAP app, SID807 profil).',
    optimal: 'Egyezzen a műszerfal kijelzésével.',
    cars: { '5008': 'Nincs külön megfigyelés.', '508': 'Nincs külön megfigyelés.' },
  },
  {
    id: 'vgtReq',
    label: 'Turbó (VGT) kért helyzet',
    unit: '%',
    decimals: 0,
    status: 'identified',
    source: { kind: 'zone', zone: 'CA', bytes: '12', decode: u8(12) },
    range: [0, 100],
    description: 'A változó geometriájú turbó lapátjainak kért helyzete. Gyári zóna 21CA, 12. bájt, % = nyers (FAP app, SID807 profil).',
    optimal: 'A töltőnyomás szabályozásával együtt mozog.',
    cars: { '5008': 'Nincs külön megfigyelés.', '508': 'Nincs külön megfigyelés.' },
  },
  {
    id: 'vgtAct',
    label: 'Turbó (VGT) mért helyzet',
    unit: '%',
    decimals: 0,
    status: 'identified',
    source: { kind: 'zone', zone: 'CA', bytes: '13', decode: u8(13) },
    range: [0, 100],
    description: 'A változó geometriájú turbó lapátjainak mért helyzete. Gyári zóna 21CA, 13. bájt, % = nyers (FAP app, SID807 profil).',
    optimal: 'Kövesse a kért helyzetet. Tartós eltérés kormos, szoruló lapátokra utal.',
    cars: { '5008': 'Nincs külön megfigyelés.', '508': 'Nincs külön megfigyelés.' },
  },
  {
    id: 'throttleReq',
    label: 'Fojtószelep kért helyzet',
    unit: '%',
    decimals: 0,
    status: 'identified',
    source: { kind: 'zone', zone: 'CA', bytes: '16', decode: u8(16) },
    range: [0, 100],
    description: 'A szívócső-fojtószelep (air mixer) kért helyzete. Gyári zóna 21CA, 16. bájt, % = nyers (FAP app, SID807 profil).',
    optimal: 'Meleg motorral nyitva; hidegen és leállításkor zár.',
    cars: { '5008': 'Nincs külön megfigyelés.', '508': 'Nincs külön megfigyelés.' },
  },
  {
    id: 'throttleAct',
    label: 'Fojtószelep mért helyzet',
    unit: '%',
    decimals: 0,
    status: 'identified',
    source: { kind: 'zone', zone: 'CA', bytes: '17', decode: u8(17) },
    range: [0, 100],
    description: 'A szívócső-fojtószelep (air mixer) mért helyzete. Gyári zóna 21CA, 17. bájt, % = nyers (FAP app, SID807 profil).',
    optimal: 'Kövesse a kért helyzetet.',
    cars: { '5008': 'Nincs külön megfigyelés.', '508': 'Nincs külön megfigyelés.' },
  },
  {
    id: 'railReq',
    label: 'Kért rail-nyomás',
    unit: 'bar',
    decimals: 0,
    status: 'identified',
    source: { kind: 'zone', zone: 'C9', bytes: '10–11', decode: u16(10) },
    range: [0, 1800],
    description: 'A common-rail kért üzemanyagnyomása. Gyári zóna 21C9, 10–11. bájt, bar = nyers (FAP app, SID807 profil).',
    optimal: 'Alapjáraton kb. 250–350 bar, terhelésnél 1600 bar fölé is nő.',
    cars: { '5008': 'Nincs külön megfigyelés.', '508': 'Nincs külön megfigyelés.' },
  },
  {
    id: 'railAct',
    label: 'Mért rail-nyomás',
    unit: 'bar',
    decimals: 0,
    status: 'identified',
    source: { kind: 'zone', zone: 'C9', bytes: '12–13', decode: u16(12) },
    range: [0, 1800],
    description: 'A common-rail mért üzemanyagnyomása. Gyári zóna 21C9, 12–13. bájt, bar = nyers (FAP app, SID807 profil).',
    optimal: 'Kövesse a kért értéket. Tartósan alatta: szivattyú, szűrő vagy szabályzószelep hiba (P0087).',
    cars: { '5008': 'Nincs külön megfigyelés.', '508': 'Nincs külön megfigyelés.' },
  },
  {
    id: 'injQty',
    label: 'Befecskendezett mennyiség',
    unit: 'mg/löket',
    decimals: 1,
    status: 'identified',
    source: { kind: 'zone', zone: 'C9', bytes: '14–15', decode: (b) => (b.length > 15 ? (b[14] * 256 + b[15]) / 10 : null) },
    range: [0, 60],
    description: 'A löketenként befecskendezett üzemanyag. Gyári zóna 21C9, 14–15. bájt, mg/löket = nyers / 10 (FAP app, SID807 profil).',
    optimal: 'Meleg alapjáraton kb. 4–8 mg/löket, motorféknél 0, teljes terhelésnél 40–50 fölött.',
    cars: { '5008': 'Nincs külön megfigyelés.', '508': 'Nincs külön megfigyelés.' },
  },
  {
    id: 'fuelTemp',
    label: 'Üzemanyag-hőmérséklet',
    unit: '°C',
    decimals: 0,
    status: 'identified',
    source: { kind: 'zone', zone: 'C9', bytes: '22', decode: (b) => (b.length > 22 ? b[22] - 50 : null) },
    range: [-20, 90],
    description: 'A gázolaj hőmérséklete. Gyári zóna 21C9, 22. bájt, °C = nyers − 50 (FAP app, SID807 profil).',
    optimal: 'Menet közben a környezetinél melegebb, általában 20–60 °C.',
    cars: { '5008': 'Nincs külön megfigyelés.', '508': 'Nincs külön megfigyelés.' },
  },
  {
    id: 'oilTemp',
    label: 'Olajhőmérséklet',
    unit: '°C',
    decimals: 0,
    status: 'identified',
    source: { kind: 'zone', zone: 'CD', bytes: '12', decode: (b) => (b.length > 12 ? b[12] - 50 : null) },
    range: [0, 140],
    ok: [80, 120],
    description: 'A motorolaj hőmérséklete. Gyári zóna 21CD, 12. bájt, °C = nyers − 50 (FAP app, SID807 profil).',
    optimal: 'Üzemi hőfokon 90–110 °C. A hűtővíznél lassabban melegszik.',
    cars: { '5008': 'Nincs külön megfigyelés.', '508': 'Nincs külön megfigyelés.' },
  },

  // 🟡 Kérdéses -----------------------------------------------------------------------------
  {
    id: 'fapLifeLeft',
    label: 'FAP hátralévő élettartam (jelölt)',
    unit: 'km',
    decimals: 0,
    status: 'questionable',
    source: { kind: 'zone', zone: 'CB', bytes: '12–14', decode: u24(12) },
    description:
      'A FAP Lite app (SID807 profil) szerint a részecskeszűrő hátralévő élettartama. Gyári zóna 21CB, 12–14. bájt, km = nyers. Ellentmondás: a naplóink szerint a 14. bájt mindig a FAP-pal megtett km (b34–36) alsó bájtjának másolata, akkor viszont nem csökkenhet egyenletesen.',
    optimal: 'Ha tényleg hátralévő km, menet közben csökkennie kell. Egy hosszabb napló a b34–36-tal együtt eldönti.',
    cars: { '5008': 'Kb. 95 000 km (0x0173xx).', '508': 'Kb. 54 000 km (0x00D4xx).' },
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
      'Üzemállapot bitekben (jelölt). Gyári zóna 21C7, 7. bájt (ugyanez a 21CC b3 és a 21CE b7). 0x10 bit = terhelés. A 0x06 a FAP Lite szerint a fékpedál (lásd Fékpedál), nem az álló autó.',
    optimal: '0xA6 álló autó lenyomott fékkel, 0xA0 gurulás, 0xB0 terhelés. A 0x20 bit hiánya (pl. 0x80) helyettesítő üzemmódra utalhat.',
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
    description:
      'Állapotbájt (jelölt). Gyári zóna 21CB, 27. bájt. Indulás után 0, kb. 4 perc múlva 16 (0x10) és úgy marad. Az alsó bitek a FAP app szerint a regenerálás (0x04) és a fűtő fogyasztók (0x08) jelzői, lásd fent.',
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
