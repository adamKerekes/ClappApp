import type { PairedDevice } from './index';

export type { PairedDevice } from './index';

/**
 * Webes előnézethez: egy kitalált ELM327 adapter és autó. A natív modullal azonos
 * felületet ad, így az OBD képernyő weben is végigkattintható, valódi Bluetooth nélkül.
 * Az értékek idővel változnak, mintha az autó járna.
 */

const DEVICES: PairedDevice[] = [
  { name: 'OBDII (demo)', address: '00:1D:A5:00:00:01' },
  { name: 'Fülhallgató', address: '00:1D:A5:00:00:02' },
];

const hex = (value: number, bytes: number) =>
  Math.max(0, Math.min(Math.round(value), 256 ** bytes - 1))
    .toString(16)
    .toUpperCase()
    .padStart(bytes * 2, '0');

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Bitmaszk a támogatott PID-ekből egy 32-es tartományban (pl. 0100, 0120…). */
function supportMask(base: number, pids: number[], hasNext: boolean): string {
  let mask = 0;
  for (const pid of pids) {
    if (pid > base && pid <= base + 32) mask |= 1 << (31 - (pid - base - 1));
  }
  if (hasNext) mask |= 1;
  return hex(mask >>> 0, 4);
}

const SUPPORTED = [0x04, 0x05, 0x0b, 0x0c, 0x0d, 0x0f, 0x10, 0x11, 0x2f, 0x34, 0x3c, 0x3e, 0x42, 0x44, 0x78, 0x7a, 0x7c];

/** Kitalált gyári zónák a PSA olvasáshoz; néhány idővel változik. */
function zoneData(zone: number, t: number): string | null {
  if (zone % 7 !== 0 && zone !== 0xc1) return null;
  if (zone === 0xc1) return `${hex(40 + (t / 20) % 30, 1)}0A1F${hex(t % 255, 1)}`;
  return `${hex(zone, 1)}${hex(zone * 3, 1)}00${hex((zone * 17 + Math.floor(t / 30)) % 255, 1)}`;
}

let connected = false;
let header = '7DF';
let dtcs = ['P0420', 'P2002'];
const start = Date.now();

function respond(command: string): string {
  const cmd = command.replace(/\s+/g, '').toUpperCase();
  const t = (Date.now() - start) / 1000;
  // Városi autózás: a sebesség és a fordulat lassan hullámzik.
  const speed = 45 + 35 * Math.sin(t / 8);
  const rpm = 900 + speed * 32 + 150 * Math.sin(t * 1.3);
  const coolant = Math.min(90, 40 + t / 2);

  if (cmd === 'ATZ') return 'ELM327 v1.5 (demo)';
  if (cmd === 'ATRV') return `${(14.1 + 0.2 * Math.sin(t / 3)).toFixed(1)}V`;
  if (cmd === 'ATDPN') return 'A6';
  if (cmd === 'ATDP') return 'AUTO, ISO 15765-4 (CAN 11/500)';
  if (cmd.startsWith('ATSH')) {
    header = cmd.slice(4) || '7DF';
    return 'OK';
  }
  if (cmd.startsWith('AT')) return 'OK';

  // Gyári (PSA) címen: munkamenet és zónák.
  if (header !== '7DF') {
    if (cmd === '81') return 'C1EF8F';
    if (cmd === '10C0') return '50C0';
    if (cmd === '3E' || cmd === '82' || cmd === '1081') return 'OK';
    if (cmd.startsWith('21')) {
      const zone = parseInt(cmd.slice(2), 16);
      const data = zoneData(zone, t);
      return data ? `61${cmd.slice(2)}${data}` : '7F2112';
    }
    return 'NO DATA';
  }

  if (cmd === '0902') {
    return `490201${[...'VF30DEMO0B0000001'].map((c) => hex(c.charCodeAt(0), 1)).join('')}`;
  }
  if (cmd === '03') {
    const body = dtcs
      .map((code) => {
        const system = 'PCBU'.indexOf(code[0]);
        const value = (system << 14) | parseInt(code.slice(1), 16);
        return hex(value, 2);
      })
      .join('');
    return `43${hex(dtcs.length, 1)}${body}`;
  }
  if (cmd === '04') {
    dtcs = [];
    return '44';
  }

  if (cmd.startsWith('01') && cmd.length === 4) {
    const pid = parseInt(cmd.slice(2), 16);
    const p = cmd.slice(2);
    if (pid % 0x20 === 0) return `41${p}${supportMask(pid, SUPPORTED, pid < 0x60)}`;
    switch (pid) {
      case 0x04: return `41${p}${hex((25 + 20 * Math.sin(t / 5)) * 2.55, 1)}`;
      case 0x05: return `41${p}${hex(coolant + 40, 1)}`;
      case 0x0b: return `41${p}${hex(100 + 40 * Math.sin(t / 5), 1)}`;
      case 0x0c: return `41${p}${hex(rpm * 4, 2)}`;
      case 0x0d: return `41${p}${hex(speed, 1)}`;
      case 0x0f: return `41${p}${hex(18 + 40, 1)}`;
      case 0x10: return `41${p}${hex((8 + 6 * Math.sin(t / 5)) * 100, 2)}`;
      case 0x11: return `41${p}${hex((15 + 10 * Math.sin(t / 5)) * 2.55, 1)}`;
      case 0x2f: return `41${p}${hex(62 * 2.55, 1)}`;
      case 0x34: return `41${p}${hex((1 + 0.03 * Math.sin(t)) * 32768, 2)}00000000`;
      case 0x3c: return `41${p}${hex((380 + 60 * Math.sin(t / 10) + 40) * 10, 2)}`;
      case 0x3e: return `41${p}${hex((340 + 50 * Math.sin(t / 10) + 40) * 10, 2)}`;
      case 0x42: return `41${p}${hex(14100 + 200 * Math.sin(t / 3), 2)}`;
      case 0x44: return `41${p}${hex(32768, 2)}`;
      case 0x78: return `4178${'01'}${hex((420 + 50 * Math.sin(t / 9) + 40) * 10, 2)}000000000000`;
      case 0x7a: return `417A${'01'}${hex((45 + 15 * Math.sin(t / 6)) * 10, 2)}0000`;
      case 0x7c: return `417C${'01'}${hex((360 + 40 * Math.sin(t / 9) + 40) * 10, 2)}000000000000`;
    }
  }
  return 'NO DATA';
}

export const ObdBluetooth = {
  isAvailable: () => true,
  isEnabled: () => true,
  isConnected: () => connected,
  getPairedDevices: async () => DEVICES,
  async connect(address: string) {
    await wait(600);
    if (address !== DEVICES[0].address) throw new Error('Ez az eszköz nem OBD adapter (demo).');
    connected = true;
    header = '7DF';
  },
  async sendCommand(command: string, _timeoutMs: number) {
    if (!connected) throw new Error('Nincs kapcsolat.');
    await wait(command === '0100' ? 800 : 40);
    return `${respond(command)}\r\r>`.replace(/>$/, '');
  },
  disconnect() {
    connected = false;
  },
};
