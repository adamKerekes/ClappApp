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
};

/**
 * Csak Androidon, development buildben létezik. Expo Go-ban és weben `null`.
 */
export const ObdBluetooth = requireOptionalNativeModule<ObdBluetoothNativeModule>('ObdBluetooth');
