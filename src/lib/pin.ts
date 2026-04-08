import { PIN_CHARSET } from "@/types";

/**
 * Generate a room PIN: 6 alphanumeric chars (uppercase),
 * excluding O/0/I/1 for readability.
 */
export function generatePin(length = 6): string {
  const chars = PIN_CHARSET;
  let pin = "";
  for (let i = 0; i < length; i++) {
    pin += chars[Math.floor(Math.random() * chars.length)];
  }
  return pin;
}
