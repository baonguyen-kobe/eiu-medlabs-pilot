/**
 * Owner decision 2026-11-18: every import (schedules, catalogs, personnel) is
 * hidden until reopened. Set NEXT_PUBLIC_IMPORTS_ENABLED=true to show them;
 * the E2E configs do, so the import flows stay tested.
 */
export function importsEnabled() {
  return process.env.NEXT_PUBLIC_IMPORTS_ENABLED === "true";
}

export const IMPORT_PATHS = [
  "/imports",
  "/schedule-entry/import",
  "/basic-medical/import",
  "/equipment/import",
];
