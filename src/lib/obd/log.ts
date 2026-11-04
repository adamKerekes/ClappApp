import { Platform } from 'react-native';

/**
 * Rögzítési fájlok (CSV) a telefonon, a `naplok` mappában. Minden rögzítés új fájl, a sorok
 * azonnal kiíródnak, így a hossz nincs korlátozva. A fájlból a `scripts/analyze-log.py`
 * keresi meg, melyik gyári bájt mivel mozog együtt.
 */

/** A naplófájlok helye és kezelése a telefonon. Csak natív buildben működik. */
export type LogFile = {
  name: string;
  uri: string;
  append(text: string): Promise<void>;
};

const LOG_DIR = 'naplok';

/** Weben (előnézet) nincs fájlrendszer: a rögzítések a memóriában vannak, amíg nyitva az oldal. */
const isWeb = Platform.OS === 'web';
const webFiles = new Map<string, string>();

async function logDirectory() {
  const { Directory, Paths } = await import('expo-file-system');
  const dir = new Directory(Paths.document, LOG_DIR);
  dir.create({ idempotent: true, intermediates: true });
  return dir;
}

export async function createLogFile(header: string, tag: string, time = new Date()): Promise<LogFile> {
  const stamp = time.toISOString().slice(0, 19).replace(/[:T]/g, '-');
  if (isWeb) {
    const name = `clapp-naplo-${tag}-${stamp}.csv`;
    webFiles.set(name, header);
    return { name, uri: name, append: async (text) => void webFiles.set(name, (webFiles.get(name) ?? '') + text) };
  }
  const { File } = await import('expo-file-system');
  const dir = await logDirectory();
  // A fájlnévben az autó (és ha van, az alvázszám), így a lista autónként szétválik.
  const file = new File(dir, `clapp-naplo-${tag}-${stamp}.csv`);
  file.create({ overwrite: true });
  await file.write(header);
  return {
    name: file.name,
    uri: file.uri,
    append: (text) => file.write(text, { append: true }),
  };
}

export type SavedLog = { name: string; uri: string; size: number };

/**
 * Az ennél kisebb fájlok nem kellenek (régi próba- és zónaeredmények, üres naplók,
 * a listában „1 kB”), ezért nem jelennek meg.
 */
export const MIN_SAVED_SIZE = 1536;

/** A telefonon tárolt naplók, a legújabb elöl. */
export async function listLogFiles(): Promise<SavedLog[]> {
  if (isWeb) {
    return [...webFiles.entries()]
      .map(([name, text]) => ({ name, uri: name, size: text.length }))
      .filter((f) => f.size >= MIN_SAVED_SIZE)
      .reverse();
  }
  const { File } = await import('expo-file-system');
  const dir = await logDirectory();
  return dir
    .list()
    .filter((item): item is InstanceType<typeof File> => item instanceof File && /\.(csv|txt)$/.test(item.name))
    .map((f) => ({ name: f.name, uri: f.uri, size: f.size ?? 0 }))
    .filter((f) => f.size >= MIN_SAVED_SIZE)
    .sort((a, b) => b.name.slice(-23).localeCompare(a.name.slice(-23)));
}

export async function deleteLogFile(uri: string): Promise<void> {
  if (isWeb) {
    webFiles.delete(uri);
    return;
  }
  const { File } = await import('expo-file-system');
  new File(uri).delete();
}

/** A fájl megosztása (e-mail, Drive, üzenet…). */
export async function shareLogFile(uri: string): Promise<void> {
  if (isWeb) {
    // Weben letöltjük a fájlt.
    const blob = new Blob([webFiles.get(uri) ?? ''], { type: 'text/csv' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = uri;
    link.click();
    return;
  }
  const Sharing = await import('expo-sharing');
  const mimeType = uri.endsWith('.txt') ? 'text/plain' : 'text/csv';
  await Sharing.shareAsync(uri, { mimeType, dialogTitle: 'Clapp fájl megosztása' });
}
