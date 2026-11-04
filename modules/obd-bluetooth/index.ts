import { requireOptionalNativeModule } from 'expo';

export type PairedDevice = {
  name: string;
  address: string;
};

type ObdBluetoothNativeModule = {
  isAvailable(): boolean;
  isEnabled(): boolean;
  isConnected(): boolean;
  getPairedDevices(): Promise<PairedDevice[]>;
  connect(address: string): Promise<void>;
  /** Elküld egy parancsot, és visszaadja a választ a `>` promptig. */
  sendCommand(command: string, timeoutMs: number): Promise<string>;
  disconnect(): void;
  /** Rögzítés közben ne kapcsoljon ki a képernyő. (Régebbi buildben nincs.) */
  setKeepScreenOn?(enabled: boolean): boolean;
  /** Előtérszolgáltatás értesítéssel, hogy a rögzítés háttérben is fusson. (Régebbi buildben nincs.) */
  startRecordingService?(title: string, text: string): boolean;
  stopRecordingService?(): void;
};

/**
 * Csak Androidon, development buildben létezik. Expo Go-ban és weben `null`.
 */
export const ObdBluetooth = requireOptionalNativeModule<ObdBluetoothNativeModule>('ObdBluetooth');
