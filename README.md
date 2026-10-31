# Clapp

Expo (React Native + TypeScript) mobilalkalmazás, Expo Routerrel és Supabase háttérrel.

- **Expo SDK 58**, React Native 0.88, TypeScript (strict)
- **Expo Router**: fájl alapú navigáció, a képernyők a `src/app/` mappában vannak
- **Supabase**: a kliens a `src/lib/supabase.ts` fájlban, a session `AsyncStorage`-ben tárolódik
- **EAS**: build profilok az `eas.json` fájlban

## Előfeltételek

- Node.js 20 vagy újabb
- A telefonodon az **Expo Go** alkalmazás ([iOS](https://apps.apple.com/app/expo-go/id982107779), [Android](https://play.google.com/store/apps/details?id=host.exp.exponent))
- Egy Supabase projekt ([supabase.com](https://supabase.com))

## Indítás Expo Go-val

```bash
npm install
cp .env.example .env   # majd töltsd ki a Supabase adatokat
npx expo start
```

A terminálban megjelenik egy QR-kód:

- **iOS**: olvasd be a beépített Kamera alkalmazással.
- **Android**: olvasd be az Expo Go alkalmazáson belül.

A telefonnak és a gépnek ugyanazon a Wi-Fi hálózaton kell lennie. Ha ez nem megy (például céges hálózaton), indítsd így: `npx expo start --tunnel`.

A kezdőképernyőn a „Supabase” sor mutatja, hogy a kliens be van-e állítva (`connected`, vagy `missing .env`).

## Környezeti változók

A konfiguráció a `.env` fájlból jön, ami nincs verziókezelve. Minta: [`.env.example`](.env.example).

| Változó | Honnan |
| --- | --- |
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase Dashboard → Project Settings → API → Project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase Dashboard → Project Settings → API → anon / publishable key |

Az `EXPO_PUBLIC_` előtagú változók bekerülnek az app bundle-be, ezért csak publikus értéket tegyél ide. A `service_role` kulcsot soha ne használd az appban: a jogosultságokat Row Level Security szabályokkal kezeld.

A `.env` módosítása után indítsd újra a dev szervert (`npx expo start -c`).

## Supabase használata

```ts
import { supabase } from '@/lib/supabase';

const { data, error } = await supabase.from('todos').select('*');
```

## EAS (build és kiadás)

```bash
npm install -g eas-cli   # vagy: npx eas-cli@latest <parancs>
eas login
eas init                 # összeköti a projektet az Expo fiókoddal (projectId az app.json-ba)
```

Profilok (`eas.json`):

| Profil | Mire való |
| --- | --- |
| `development` | Development build (`expo-dev-client` kell hozzá), ha olyan natív modul kerül be, amit az Expo Go nem tartalmaz |
| `preview` | Belső tesztelésre szánt build (APK / ad hoc iOS) |
| `production` | Áruházba szánt build, automatikus verziószám-növeléssel |

```bash
eas build --profile preview --platform android
eas build --profile production --platform all
```

A buildekhez a környezeti változókat az EAS-ben kell megadni (`eas env:create`, vagy az expo.dev felületén), mert a `.env` nem kerül fel.

Az `app.json`-ban a `com.clapp.app` bundle azonosító helykitöltő: az első áruházi build előtt cseréld a sajátodra.

## Automatikus Android build (parancsok nélkül)

Minden alkalommal, amikor valami bekerül a `main` ágba (például merge-elsz egy PR-t), a GitHub magától elindít egy Android buildet az EAS-en ([`.github/workflows/android-build.yml`](.github/workflows/android-build.yml)). Ez **preview** build: önálló app, a teljes kód benne van, nem kell hozzá gép vagy dev szerver.

### Egyszeri beállítás (kb. 3 perc, csak kattintás)

1. **Expo token**: [expo.dev → Access tokens](https://expo.dev/settings/access-tokens) → **Create token** → név: `github` → **Create**, és másold ki a tokent (csak egyszer látod).
2. **GitHub secret**: a repóban **Settings → Secrets and variables → Actions → New repository secret**. Name: `EXPO_TOKEN`, Secret: a kimásolt token → **Add secret**.
3. Első build kézzel: **Actions → Android build → Run workflow → Run workflow**.

### Telepítés a telefonra

- A futás végén a GitHub **Actions** fülön, a futás összefoglalójában ott a build linkje. Ugyanez megtalálható az [expo.dev](https://expo.dev) oldalon a Clapp projekt **Builds** listájában.
- A build 10–30 perc. Utána nyisd meg a linket a telefonon → **Install** → telepítsd az `.apk`-t (az első alkalommal engedélyezd az „ismeretlen forrásból” telepítést a böngészőnek). Az új verzió a régire települ, az adatok megmaradnak.

A **development** profilt (dev client) is lehet kézzel indítani: **Run workflow** → Build profil: `development`.

A Supabase adatokat (`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`) az expo.dev oldalon a projekt **Environment variables** menüjében kell megadni a `preview` környezethez, mert a `.env` nem kerül fel.

## Hasznos parancsok

```bash
npx expo start            # dev szerver
npx expo install <csomag> # SDK-kompatibilis csomagtelepítés (npm install helyett)
npx tsc --noEmit          # típusellenőrzés
npx expo lint             # lint
npx expo-doctor           # függőségek és konfiguráció ellenőrzése
```

## OBD-II adapter (Bluetooth)

Az **OBD** fül egy olcsó ELM327 Bluetooth adapterről olvas élő adatokat (fordulatszám, sebesség, hűtővíz, terhelés, akkufeszültség stb.) és hibakódokat. Csak **Androidon** működik, klasszikus Bluetooth (SPP) adapterrel, és **development build** kell hozzá: az Expo Go-ban nincs benne a Bluetooth modul.

A natív rész a [`modules/obd-bluetooth`](modules/obd-bluetooth) helyi Expo modulban van, az ELM327 protokoll a [`src/lib/obd`](src/lib/obd) mappában.

### Development build telepítése Windowson (cmd)

A legegyszerűbb az [automatikus build](#automatikus-android-build-parancsok-nélkül): az OBD fül abban is működik. Az alábbi kézi út csak akkor kell, ha dev szerverrel akarsz fejleszteni.

Egyszer kell megcsinálni, és csak akkor újra, ha natív kód vagy natív csomag változik. A JavaScript módosítások a dev szerverről jönnek.

1. Telepítsd a [Node.js LTS](https://nodejs.org) verzióját, ha még nincs meg.
2. Nyiss egy **Parancssort** (Start menü → `cmd`), és lépj be a projekt mappájába:
   ```
   cd C:\ide\a\projekt\mappaja\clappapp
   git pull
   npm install
   ```
3. Jelentkezz be az Expo fiókodba (ha nincs, regisztrálj az [expo.dev](https://expo.dev) oldalon):
   ```
   npx eas-cli@latest login
   ```
4. Csak az első alkalommal kösd össze a projektet az Expo fiókoddal (minden kérdésre `Y`):
   ```
   npx eas-cli@latest init
   ```
5. Indítsd el a buildet a felhőben:
   ```
   npx eas-cli@latest build --profile development --platform android
   ```
   Ha azt kérdezi, hogy generáljon-e Android Keystore-t, válaszd az `Y`-t. A build 10–30 percig tart, közben a gép bezárható. A végén kapsz egy linket és egy QR-kódot (az [expo.dev](https://expo.dev) oldalon a projektnél is megtalálod).
6. A telefonon nyisd meg a linket, töltsd le az `.apk` fájlt és telepítsd. Ha az Android rákérdez, engedélyezd az „ismeretlen forrásból” telepítést a böngészőnek.
7. A gépen indítsd a dev szervert:
   ```
   npx expo start --dev-client
   ```
   Nyisd meg a telefonon a **Clapp** appot: ha a telefon és a gép ugyanazon a Wi-Fin van, megjelenik a listában a szerver, vagy olvasd be a QR-kódot. Ha nem találja, indítsd így: `npx expo start --dev-client --tunnel`.

### Az adapter használata

1. Dugd be az adaptert az autó OBD csatlakozójába (általában a kormány alatt), és add rá a gyújtást (vagy indítsd be a motort).
2. A telefonon: **Beállítások → Bluetooth** → párosítsd az adaptert (neve általában `OBDII`, `OBD2` vagy `V-LINK`, a PIN `1234` vagy `0000`).
3. Az appban nyisd meg az **OBD** fület, engedélyezd a „Közeli eszközök” jogosultságot, majd koppints az adapterre.
4. Az első kapcsolódás 5–15 másodperc, mert az adapter megkeresi az autó protokollját. Utána folyamatosan frissülnek az értékek, a csempék közül csak azok jelennek meg, amiket az autó támogat.

Ha az adapter nem jelenik meg a párosítható eszközök között, valószínűleg Bluetooth Low Energy (BLE) típusú, amit ez a verzió még nem kezel.

### Gyári adatok azonosítása (Peugeot / Citroën, kísérleti)

Mind csak olvas, a vezérlőbe semmit nem ír.

1. **Ismert gyári adatok (OBDb lista):** az [OBDb Peugeot-508](https://github.com/OBDb/Peugeot-508) közösségi lista 353 kérését (367 jel névvel és mértékegységgel) egyszer végigkérdezi, és megjegyzi, melyikre válaszol az autó. A válaszolók névvel jelennek meg. A lista nincs autón igazolva, és főleg 2014 utáni motorokhoz készült.
2. **Gyári adatok (zónák):** a motorvezérlő 21xx zónáit nyersen olvassa ki.
3. **Napló vezetés közben:** az előző kettő válaszoló adatait és a szabványos értékeket körönként egy CSV fájlba menti a telefonon (`naplok` mappa, hosszkorlát nélkül). A **Mentett naplók** listából a fájl megosztható.
4. **Elemzés a gépen:**
   ```bash
   python3 scripts/analyze-log.py clapp-naplo-2026-....csv --out jelentes.md
   ```
   Kiírja, melyik bájt mozog együtt melyik ismert értékkel (és milyen képlettel), és alak szerint besorolja a többit (számláló, lenullázódó számláló, kapcsoló, állandó).

Javasolt menet egy naplóhoz: hidegindítás után indítsd a naplót, 1 perc alapjárat, 3–4 gázfröccs állva (2000, 3000 1/min), utána városi szakasz, végül legalább 15–20 perc egyenletes országúti vagy autópályás út. Ha regenerálás közben is fut a napló, abból látszanak a DPF adatok.

## Mappaszerkezet

```
src/
  app/          # Expo Router képernyők és layoutok
  components/   # Újrahasználható komponensek
  constants/    # Téma, színek, térközök
  hooks/        # Saját hookok
  lib/          # Supabase kliens, OBD (ELM327) logika és egyéb szolgáltatások
modules/        # Helyi natív Expo modulok (obd-bluetooth)
assets/         # Ikonok, képek, splash
```
