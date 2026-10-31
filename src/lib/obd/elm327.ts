import { ObdBluetooth } from '../../../modules/obd-bluetooth';

import type { PidDefinition } from './pids';

const DEFAULT_TIMEOUT_MS = 2000;

/** Az ELM327 hibaüzenetei, amik azt jelentik, hogy erre a kérésre nincs adat. */
const NO_DATA_RESPONSES = ['NODATA', 'STOPPED', '?', 'CANERROR', 'BUSERROR', 'ERROR'];

export class ObdError extends Error {}

function getModule() {
  if (!ObdBluetooth) {
    throw new ObdError('A Bluetooth modul nem elérhető. Development buildre van szükség (Expo Go nem jó).');
  }
  return ObdBluetooth;
}

/** Sorokra bontja a választ, kiszedi a szóközöket és a "SEARCHING..." sort. */
export function cleanLines(raw: string): string[] {
  return raw
    .split(/[\r\n]+/)
    .map((line) => line.replace(/\s+/g, '').toUpperCase())
    .filter((line) => line.length > 0 && !line.startsWith('SEARCHING'));
}

export function hexToBytes(hex: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i + 1 < hex.length; i += 2) {
    const value = parseInt(hex.slice(i, i + 2), 16);
    if (Number.isNaN(value)) break;
    bytes.push(value);
  }
  return bytes;
}

/**
 * Több képkockás (ISO-TP) CAN válasz összefűzése. Fejlécek nélkül az ELM327 így írja:
 * `014` / `0:4306010301040` / `1:...`. Az első sor a hossz, a többi sorszámozott.
 */
export function joinFrames(lines: string[]): string[] {
  if (!lines.some((line) => /^[0-9A-F]:/.test(line))) {
    return lines;
  }
  const joined = lines
    .filter((line) => /^[0-9A-F]:/.test(line))
    .map((line) => line.slice(2))
    .join('');
  return [joined];
}

/** Egy 2 bájtos hibakód (pl. 0x01 0x33) szöveggé alakítása (P0133). */
export function decodeDtc(high: number, low: number): string {
  const system = ['P', 'C', 'B', 'U'][high >> 6];
  const firstDigit = (high >> 4) & 0x03;
  const rest = ((high & 0x0f) << 8) | low;
  return `${system}${firstDigit}${rest.toString(16).toUpperCase().padStart(3, '0')}`;
}

export class Elm327 {
  /** CAN protokollon a 03-as válasz első bájtja a hibakódok száma, nem kód. */
  private isCan = false;
  private supportedPids = new Set<string>();
  adapterVersion = '';
  /** Alvázszám (Mode 09), ha az autó megadja; ezzel választjuk szét a naplókat autónként. */
  vin: string | null = null;
  protocol = '';

  private queue: Promise<unknown> = Promise.resolve();

  /** Parancs küldése. Egyszerre csak egy mehet, ezért sorba állítjuk őket. */
  private sendRaw(command: string, timeoutMs: number): Promise<string> {
    const result = this.queue
      .catch(() => {})
      .then(() => getModule().sendCommand(command, timeoutMs));
    this.queue = result;
    return result;
  }

  /** Parancs küldése, a válasz szóközök nélküli, nagybetűs sorai. */
  async send(command: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<string[]> {
    return cleanLines(await this.sendRaw(command, timeoutMs));
  }

  /** Szöveges válaszhoz (pl. verzió), a szóközöket megtartja. */
  private async sendText(command: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<string> {
    const raw = await this.sendRaw(command, timeoutMs);
    return raw
      .split(/[\r\n]+/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && line !== command)
      .join(' ');
  }

  /** Alaphelyzetbe állítja az adaptert és felveszi a kapcsolatot az autóval. */
  async initialize(): Promise<void> {
    this.adapterVersion = await this.sendText('ATZ', 5000);
    await this.send('ATE0'); // echo ki
    await this.send('ATL0'); // sorvége ki
    await this.send('ATS0'); // szóközök ki
    await this.send('ATH0'); // fejlécek ki
    await this.send('ATAT1'); // adaptív időzítés
    await this.send('ATSP0'); // protokoll automatikus felismerése

    // Az első kérésnél keresi meg a protokollt, ez akár 10 másodperc is lehet.
    const first = await this.send('0100', 15000);
    if (first.some((line) => line.includes('UNABLETOCONNECT'))) {
      throw new ObdError('Az adapter nem talál ECU-t. Ráadtad a gyújtást (vagy jár a motor)?');
    }

    const protocolNumber = (await this.send('ATDPN')).join('').replace(/^A/, '');
    this.isCan = ['6', '7', '8', '9', 'A', 'B', 'C'].includes(protocolNumber.charAt(0));
    this.protocol = await this.sendText('ATDP');

    await this.loadSupportedPids(first);
    this.vin = await this.readVin().catch(() => null);
  }

  /** Alvázszám kiolvasása (Mode 09, 02). `null`, ha az autó nem adja meg. */
  async readVin(): Promise<string | null> {
    const lines = joinFrames(await this.send('0902', 5000));
    // CAN: 4902 01 + 17 bájt; régebbi protokollokon soronként 4902 + sorszám + 4 bájt.
    const text = lines
      .filter((line) => line.startsWith('4902'))
      .map((line) =>
        hexToBytes(line.slice(6))
          .map((b) => String.fromCharCode(b))
          .join('')
      )
      .join('')
      .replace(/[^A-HJ-NPR-Z0-9]/g, '');
    return text.length >= 17 ? text.slice(-17) : null;
  }

  /** A 0100, 0120, 0140 válaszok bitmaszkjából kiderül, mely PID-eket ismeri az autó. */
  private async loadSupportedPids(first: string[]) {
    this.supportedPids.clear();
    let response = first;
    for (const base of [0x00, 0x20, 0x40, 0x60, 0x80]) {
      if (base > 0) {
        try {
          response = await this.send(`01${base.toString(16).toUpperCase().padStart(2, '0')}`);
        } catch {
          break;
        }
      }
      const bytes = this.findMode01Payload(response, base);
      if (!bytes || bytes.length < 4) break;
      const mask = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
      for (let bit = 0; bit < 32; bit++) {
        if (mask & (1 << (31 - bit))) {
          this.supportedPids.add((base + bit + 1).toString(16).toUpperCase().padStart(2, '0'));
        }
      }
      // Az utolsó bit jelzi, hogy van-e következő tartomány.
      if (!(mask & 1)) break;
    }
  }

  isSupported(pid: string): boolean {
    // Ha nem sikerült kiolvasni a listát, mindent megpróbálunk.
    return this.supportedPids.size === 0 || this.supportedPids.has(pid);
  }

  private findMode01Payload(lines: string[], pid: number | string): number[] | null {
    const pidHex = typeof pid === 'number' ? pid.toString(16).toUpperCase().padStart(2, '0') : pid;
    const prefix = `41${pidHex}`;
    const line = lines.find((l) => l.startsWith(prefix));
    return line ? hexToBytes(line.slice(prefix.length)) : null;
  }

  /** Egy élő adat kiolvasása. `null`, ha az autó nem ad rá választ. */
  async readPid(definition: PidDefinition): Promise<number | null> {
    const lines = await this.send(`01${definition.pid}`);
    if (lines.some((line) => NO_DATA_RESPONSES.includes(line))) return null;
    const bytes = this.findMode01Payload(lines, definition.pid);
    if (!bytes || bytes.length === 0) return null;
    const value = definition.decode(bytes);
    return value == null || Number.isNaN(value) ? null : value;
  }

  /** Az adapter által mért akkumulátor feszültség (a 16-os tűn). */
  async readBatteryVoltage(): Promise<number | null> {
    const [line] = await this.send('ATRV');
    const value = parseFloat(line ?? '');
    return Number.isNaN(value) ? null : value;
  }

  /** Tárolt hibakódok (Mode 03). */
  async readDtcs(): Promise<string[]> {
    const lines = joinFrames(await this.send('03', 5000));
    const codes = new Set<string>();
    for (const line of lines) {
      if (!line.startsWith('43')) continue;
      let bytes = hexToBytes(line.slice(2));
      if (this.isCan) bytes = bytes.slice(1);
      for (let i = 0; i + 1 < bytes.length; i += 2) {
        if (bytes[i] === 0 && bytes[i + 1] === 0) continue;
        codes.add(decodeDtc(bytes[i], bytes[i + 1]));
      }
    }
    return [...codes];
  }

  /** Hibakódok törlése (Mode 04). A motorhiba lámpát is lekapcsolja. */
  async clearDtcs(): Promise<void> {
    await this.send('04', 5000);
  }
}
