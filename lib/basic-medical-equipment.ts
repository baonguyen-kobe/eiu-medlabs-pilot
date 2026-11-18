export type BasicMedicalEquipmentCatalogItem = {
  id: string;
  item_name: string;
  commercial_name: string;
  item_type: string | null;
  country_of_origin: string | null;
  manufacturer: string | null;
  model: string | null;
  unit: string;
  is_active: boolean;
};

export const MAX_BASIC_MEDICAL_CONFIRMATION_TIMER_DELAY = 2_147_000_000;

export function isBasicMedicalConfirmationTooEarly(
  eligibilityAt: number | null,
  now: number,
) {
  return eligibilityAt === null || now < eligibilityAt;
}

export function scheduleBasicMedicalConfirmationWake({
  eligibilityAt,
  now,
  setTimer,
  onWake,
}: {
  eligibilityAt: number | null;
  now: number;
  setTimer: (callback: () => void, delay: number) => number;
  onWake: () => void;
}) {
  if (eligibilityAt === null) return null;
  const delay = Math.min(
    MAX_BASIC_MEDICAL_CONFIRMATION_TIMER_DELAY,
    Math.max(1, eligibilityAt - now + 1),
  );
  return setTimer(onWake, delay);
}

export function createBasicMedicalConfirmationTimerLifecycle({
  setTimer,
  clearTimer,
  onWake,
}: {
  setTimer: (callback: () => void, delay: number) => number;
  clearTimer: (timer: number) => void;
  onWake: () => void;
}) {
  let timer: number | null = null;

  const dispose = () => {
    if (timer === null) return;
    clearTimer(timer);
    timer = null;
  };

  return {
    update({
      eligibilityAt,
      now,
    }: {
      eligibilityAt: number | null;
      now: number;
    }) {
      dispose();
      timer = scheduleBasicMedicalConfirmationWake({
        eligibilityAt,
        now,
        setTimer,
        onWake: () => {
          timer = null;
          onWake();
        },
      });
      return timer;
    },
    dispose,
  };
}

export type BasicMedicalRoomInventoryItem = {
  id: string;
  room_id: string;
  catalog_item_id: string;
  total_quantity: number;
  good_quantity: number;
  damaged_quantity: number;
  is_active: boolean;
  last_damage_reported_at: string | null;
  room: {
    id: string;
    room_code: string;
    building_code: string;
    room_name: string | null;
  } | null;
  catalog: BasicMedicalEquipmentCatalogItem | null;
  last_damage_reporter: { full_name: string } | null;
};

export type BasicMedicalSessionConfirmation = {
  id: string;
  signer_id: string;
  signed_at: string;
  invalidated_at: string | null;
  invalidated_reason: string | null;
};

export type BasicMedicalConfirmationEquipmentEvidence = {
  inventory_id: string;
  item_name_snapshot: string;
  commercial_name_snapshot: string | null;
  unit_snapshot: string;
  total_before: number;
  good_before: number;
  damaged_before: number;
  newly_damaged_quantity: number;
  total_after: number;
  good_after: number;
  damaged_after: number;
};

export type BasicMedicalConfirmationEvidence = {
  confirmation_id: string;
  registration_id_snapshot: string;
  class_schedule_id_snapshot: string;
  signer_id: string;
  signature_data: string;
  schedule_date_snapshot: string;
  start_time_snapshot: string;
  end_time_snapshot: string;
  room_id_snapshot: string;
  teaching_lecturer_id_snapshot: string;
  course_code_snapshot: string | null;
  course_name_snapshot: string | null;
  room_code_snapshot: string | null;
  building_code_snapshot: string | null;
  room_name_snapshot: string | null;
  teaching_lecturer_name_snapshot: string | null;
  signer_name_snapshot: string | null;
  display_snapshots_available: boolean;
  signed_at: string;
  invalidated_at: string | null;
  invalidated_by: string | null;
  invalidated_by_name_snapshot: string | null;
  invalidated_reason: string | null;
  equipment_checks: BasicMedicalConfirmationEquipmentEvidence[];
};

export type BasicMedicalRegistrationSessionItem = {
  id: string;
  session_number: number;
  lesson_title: string;
  teaching_lecturer_id: string;
  teaching: { full_name: string } | null;
  cancelled_at?: string | null;
  cancelled_by?: string | null;
  cancellation_reason?: string | null;
  class_schedules: {
    id: string;
    schedule_date: string;
    start_time: string;
    end_time: string;
    schedule_status: string;
  } | null;
  confirmations: BasicMedicalSessionConfirmation[];
};

export type BasicMedicalInstructorOption = {
  id: string;
  full_name: string;
  title: string | null;
};

/** Registration with its sessions and confirmations (list and detail). */
export const basicMedicalRegistrationSelect =
  "id,registration_code,created_at,created_by,registrant_id,academic_year,semester,start_date,end_date,student_count,note,cancelled_at,cancelled_by,cancel_reason,courses(course_code,course_name),rooms(id,room_code,building_code,room_name),registrant:profiles!basic_medical_registrations_registrant_id_fkey(full_name),responsible:profiles!basic_medical_registrations_responsible_lecturer_id_fkey(full_name),basic_medical_registration_sessions(id,session_number,lesson_title,teaching_lecturer_id,cancelled_at,cancelled_by,cancellation_reason,teaching:profiles!basic_medical_registration_sessions_teaching_lecturer_id_fkey(full_name),class_schedules(id,schedule_date,start_time,end_time,schedule_status),confirmations:basic_medical_session_confirmations(id,signer_id,signed_at,invalidated_at,invalidated_reason))";

export type BasicMedicalRegistrationListItem = {
  id: string;
  created_by?: string;
  registrant_id?: string;
  registration_code: string;
  created_at: string;
  academic_year: string;
  semester: string;
  start_date: string;
  end_date: string;
  student_count: number;
  note: string | null;
  cancelled_at?: string | null;
  cancelled_by?: string | null;
  cancel_reason?: string | null;
  courses: { course_code: string; course_name: string } | null;
  rooms: {
    id: string;
    room_code: string;
    building_code: string;
    room_name: string | null;
  } | null;
  registrant: { full_name: string } | null;
  responsible: { full_name: string } | null;
  basic_medical_registration_sessions: BasicMedicalRegistrationSessionItem[];
};

export type BasicMedicalConditionLogItem = {
  id: string;
  event_type: "damage_report" | "condition_adjustment" | "stock_adjustment";
  total_before: number;
  good_before: number;
  damaged_before: number;
  total_after: number;
  good_after: number;
  damaged_after: number;
  quantity_delta: number;
  note: string | null;
  created_at: string;
  inventory: {
    room: {
      room_code: string;
      building_code: string;
      room_name: string | null;
    } | null;
    catalog: {
      item_name: string;
      commercial_name: string | null;
      unit: string;
    } | null;
  } | null;
  actor: { full_name: string } | null;
};

export function activeSessionConfirmation(
  session: BasicMedicalRegistrationSessionItem,
) {
  return session.confirmations.find(
    (confirmation) => confirmation.invalidated_at === null,
  );
}

export function isBasicMedicalRegistrationCompleted(
  registration: BasicMedicalRegistrationListItem,
) {
  const sessions = registration.basic_medical_registration_sessions;
  return (
    sessions.length > 0 &&
    sessions.every((session) => activeSessionConfirmation(session))
  );
}

export function basicMedicalDamageEmailSubject(
  roomCode: string,
  roomName?: string | null,
  audience: "management" | "user" = "user",
) {
  const roomTitle = [roomCode.trim(), roomName?.trim()]
    .filter(Boolean)
    .join(" ");
  const prefix =
    audience === "management"
      ? "[Admin MedLabs Calendar]"
      : "[MedLabs Calendar]";
  return `${prefix}[Y cơ sở][Alert] Thiết bị phòng ${roomTitle} được báo Hư`;
}
