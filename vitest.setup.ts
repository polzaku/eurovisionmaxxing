import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// RTL ships an auto-cleanup hook via `afterEach`, but it only registers
// itself when vitest's globals are enabled. We use explicit imports
// (no globals), so register it manually here. Runs for every test file
// — harmless under node env (no DOM to clean).
afterEach(() => {
  cleanup();
});
