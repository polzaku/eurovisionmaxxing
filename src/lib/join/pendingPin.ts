export const PENDING_PIN_STORAGE_KEY = "emx_pending_pin";

export function stashPendingPin(storage: Storage, pin: string): void {
  storage.setItem(PENDING_PIN_STORAGE_KEY, pin);
}

export function readPendingPin(storage: Storage): string | null {
  return storage.getItem(PENDING_PIN_STORAGE_KEY);
}

export function clearPendingPin(storage: Storage): void {
  storage.removeItem(PENDING_PIN_STORAGE_KEY);
}
