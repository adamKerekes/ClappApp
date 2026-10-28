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

## Hasznos parancsok

```bash
npx expo start            # dev szerver
npx expo install <csomag> # SDK-kompatibilis csomagtelepítés (npm install helyett)
npx tsc --noEmit          # típusellenőrzés
npx expo lint             # lint
npx expo-doctor           # függőségek és konfiguráció ellenőrzése
```

## Mappaszerkezet

```
src/
  app/          # Expo Router képernyők és layoutok
  components/   # Újrahasználható komponensek
  constants/    # Téma, színek, térközök
  hooks/        # Saját hookok
  lib/          # Supabase kliens és egyéb szolgáltatások
assets/         # Ikonok, képek, splash
```
