import crypto from "node:crypto";
import assert from "node:assert/strict";

/**
 * Creates a fully validated, constraint-compliant schedule with its complete dependency chain
 * (room_type -> room -> course -> published class_schedule) under the current production schema.
 * Never assumes fixed seed IDs or hardcoded UUIDs exist.
 */
export async function createCanonicalScheduleFixture(
  service,
  creatorId,
  options = {},
) {
  const nonce = crypto.randomBytes(4).toString("hex");

  // 1. Resolve or create Skills Lab room type
  const skillsRoomTypeId = "40000000-0000-0000-0000-000000000001";
  const { data: existingType } = await service
    .from("room_types")
    .select("id")
    .eq("id", skillsRoomTypeId)
    .maybeSingle();
  if (!existingType) {
    const { error: rtErr } = await service.from("room_types").insert({
      id: skillsRoomTypeId,
      name: "Skills Lab",
      code: "skills_lab",
    });
    assert.ifError(rtErr);
  }

  // 2. Create room with unique business key
  const roomId = crypto.randomUUID();
  const { error: roomErr } = await service.from("rooms").insert({
    id: roomId,
    room_code: `R_${nonce.toUpperCase()}`,
    building_code: `B_${nonce.toUpperCase()}`,
    room_type_id: skillsRoomTypeId,
  });
  assert.ifError(roomErr);

  // 3. Create course with unique business key
  const courseId = crypto.randomUUID();
  const { error: courseErr } = await service.from("courses").insert({
    id: courseId,
    course_code: `CRS_${nonce.toUpperCase()}`,
    course_name: `Canonical Course ${nonce}`,
  });
  assert.ifError(courseErr);

  // 4. Create class_schedule with valid publication metadata and slot timing (09:00 - 11:00)
  const scheduleId = options.scheduleId ?? crypto.randomUUID();
  const scheduleDate = options.scheduleDate || "2036-03-15";
  const { error: schedErr } = await service.from("class_schedules").insert({
    id: scheduleId,
    course_id: courseId,
    course_code_snapshot: `CRS_${nonce.toUpperCase()}`,
    course_name_snapshot: `Canonical Course ${nonce}`,
    room_id: roomId,
    schedule_date: scheduleDate,
    start_time: "09:00",
    end_time: "11:00",
    source: "manual",
    schedule_status: "published",
    student_count: 20,
    semester: options.semester || "HK1",
    created_by: creatorId,
    published_by: creatorId,
    published_at: new Date().toISOString(),
    lecturer_id: null,
  });
  assert.ifError(schedErr);

  return {
    skillsRoomTypeId,
    roomId,
    courseId,
    scheduleId,
    scheduleDate,
    receiveAt: `${scheduleDate}T09:00:00+07:00`,
    returnAt: `${scheduleDate}T11:00:00+07:00`,
  };
}
