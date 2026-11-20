import "server-only";

// On by default (owner decision 2026-11-20); "false" remains an emergency switch-off.
export function isBasicMedicalConfirmationEvidenceEnabled() {
  return process.env.BASIC_MEDICAL_CONFIRMATION_EVIDENCE_ENABLED !== "false";
}
