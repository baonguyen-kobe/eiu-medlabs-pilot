import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { assertLocalSupabaseTarget } from "./helpers/local-test-safety.mjs";

const localEnv = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const [key, ...value] = line.split("=");
      return [key, value.join("=")];
    }),
);

function client(key = localEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
  return createClient(localEnv.NEXT_PUBLIC_SUPABASE_URL, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function signIn(email, password) {
  const supabase = client();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  assert.ifError(error);
  return { supabase, user: data.user };
}

test("Batch A: Teaching Assistant RPCs enforce scoped role contracts", async () => {
  assertLocalSupabaseTarget(localEnv.NEXT_PUBLIC_SUPABASE_URL);
  const workdir = process.env.CI_SUPABASE_WORKDIR ?? process.cwd();
  const config = readFileSync(resolve(workdir, "supabase/config.toml"), "utf8");
  const project = config.match(/^project_id\s*=\s*"([^"]+)"/m)?.[1];
  const apiPort = config
    .match(/\[api\]([\s\S]*?)(?=\r?\n\[)/)?.[1]
    .match(/^port\s*=\s*(\d+)/m)?.[1];
  assert.ok(project);
  assert.equal(new URL(localEnv.NEXT_PUBLIC_SUPABASE_URL).port, apiPort);
  const service = client(localEnv.SUPABASE_SECRET_KEY);
  const suffix = crypto.randomUUID();
  const fixturePhone = (index) => {
    const digits = suffix.replace(/[^0-9]/g, "");
    return `09${digits.slice(0, 7).padEnd(7, "0")}${index}`;
  };
  const outOfScopeTargetNote = `M2-01 out-of-scope target room ${suffix}`;
  const skillsCourseBasicRoomNote = `M2-01 Skills course Basic room ${suffix}`;
  const basicCourseSkillsRoomNote = `M2-01 Basic course Skills room ${suffix}`;
  const basicManualScheduleNote = `M2-01 Basic manual schedule ${suffix}`;
  const invalidLecturerNote = `M2-01 invalid lecturer assignment ${suffix}`;
  const basicCourseId = crypto.randomUUID();
  const basicRoomId = crypto.randomUUID();
  const skillsRoomId = crypto.randomUUID();
  const equipmentScheduleId = crypto.randomUUID();
  const equipmentRegressionScheduleId = crypto.randomUUID();
  const catalogItemId = crypto.randomUUID();
  const manualScheduleIds = [];
  const equipmentRequestIds = [];
  const registrationIds = [];
  const basicMedicalScheduleIds = [];
  const batchAAggregateIds = new Set([
    equipmentScheduleId,
    equipmentRegressionScheduleId,
  ]);
  const testUserIds = [];
  let lecturerId;
  let testFailure;

  async function createLocalUser({
    role,
    scopes,
    phone = null,
    allowBasicMedicalAccess = false,
  }) {
    const email = `m2-${role}-${crypto.randomUUID()}@campus.local`;
    const password = "LocalBatchA123!";
    const { data, error } = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: { preapproved: true },
      user_metadata: { full_name: `M2 ${role}` },
    });
    assert.ifError(error);
    const id = data.user.id;
    assert.ifError(
      (
        await service
          .from("profiles")
          .update({
            is_active: true,
            allow_basic_medical_access: allowBasicMedicalAccess,
            ...(phone ? { phone } : {}),
          })
          .eq("id", id)
      ).error,
    );
    assert.ifError(
      (await service.from("user_roles").upsert({ user_id: id, role })).error,
    );
    for (const roomTypeId of scopes) {
      assert.ifError(
        (
          await service.from("profile_room_types").upsert({
            profile_id: id,
            room_type_id: roomTypeId,
          })
        ).error,
      );
    }
    testUserIds.push(id);
    return { id, email, password };
  }

  async function assertManualDomainDenied(result, note) {
    if (result.data?.id) {
      manualScheduleIds.push(result.data.id);
      batchAAggregateIds.add(result.data.id);
    }
    assert.equal(result.error?.code, "42501");
    const schedules = await service
      .from("class_schedules")
      .select("id")
      .eq("note", note);
    assert.ifError(schedules.error);
    assert.equal(schedules.data.length, 0);
  }

  try {
    const adminFixture = await createLocalUser({
      role: "admin",
      scopes: ["40000000-0000-0000-0000-000000000001"],
    });
    const assistantFixture = await createLocalUser({
      role: "teaching_assistant",
      scopes: ["40000000-0000-0000-0000-000000000001"],
      phone: fixturePhone(1),
    });
    const staffFixture = await createLocalUser({
      role: "staff",
      scopes: ["40000000-0000-0000-0000-000000000001"],
    });
    const unscopedAssistantFixture = await createLocalUser({
      role: "teaching_assistant",
      scopes: [],
      allowBasicMedicalAccess: true,
    });
    const equipmentNoScopeAssistantFixture = await createLocalUser({
      role: "teaching_assistant",
      scopes: ["40000000-0000-0000-0000-000000000002"],
    });
    const scopedNoAccessAssistantFixture = await createLocalUser({
      role: "teaching_assistant",
      scopes: ["40000000-0000-0000-0000-000000000002"],
    });
    const lecturerFixture = await createLocalUser({
      role: "lecturer",
      scopes: [
        "40000000-0000-0000-0000-000000000001",
        "40000000-0000-0000-0000-000000000002",
      ],
      phone: fixturePhone(2),
    });
    lecturerId = lecturerFixture.id;
    const admin = await signIn(adminFixture.email, adminFixture.password);
    const staff = await signIn(staffFixture.email, staffFixture.password);
    const lecturer = await signIn(
      lecturerFixture.email,
      lecturerFixture.password,
    );
    const assistant = await signIn(
      assistantFixture.email,
      assistantFixture.password,
    );
    const unscopedAssistant = await signIn(
      unscopedAssistantFixture.email,
      unscopedAssistantFixture.password,
    );
    const equipmentNoScopeAssistant = await signIn(
      equipmentNoScopeAssistantFixture.email,
      equipmentNoScopeAssistantFixture.password,
    );
    const scopedNoAccessAssistant = await signIn(
      scopedNoAccessAssistantFixture.email,
      scopedNoAccessAssistantFixture.password,
    );
    assert.ifError(
      (
        await service.from("courses").insert({
          id: basicCourseId,
          course_code: `M2B-${suffix.slice(0, 8)}`,
          course_name: "M2 Basic Medical contract fixture",
          room_type_id: "40000000-0000-0000-0000-000000000002",
        })
      ).error,
    );
    assert.ifError(
      (
        await service.from("rooms").insert({
          id: basicRoomId,
          room_code: `M2B-${suffix.slice(0, 8)}`,
          building_code: "M2",
          room_name: "M2 Basic Medical contract fixture",
          room_type: "Y cơ sở",
          capacity: 30,
          room_type_id: "40000000-0000-0000-0000-000000000002",
        })
      ).error,
    );
    assert.ifError(
      (
        await service.from("rooms").insert({
          id: skillsRoomId,
          room_code: `M2S-${suffix.slice(0, 8)}`,
          building_code: "M2",
          room_name: "M2 Skills contract fixture",
          capacity: 30,
          room_type_id: "40000000-0000-0000-0000-000000000001",
        })
      ).error,
    );
    const basicPayload = (date, note) => ({
      target_registration_id: null,
      target_academic_year: "2051-2052",
      target_semester: "HK1",
      target_start_date: date,
      target_end_date: date,
      target_course_id: basicCourseId,
      target_room_id: basicRoomId,
      target_student_count: 20,
      target_responsible_lecturer_id: lecturerId,
      target_note: note,
      target_sessions: [
        {
          schedule_date: date,
          start_time: "07:30",
          end_time: "09:30",
          lesson_title: note,
          teaching_lecturer_id: lecturerId,
        },
      ],
    });

    for (const [actor, date, note] of [
      [admin.supabase, "2051-11-07", "M2-01 admin regression"],
      [staff.supabase, "2051-11-08", "M2-01 staff regression"],
      [lecturer.supabase, "2051-11-09", "M2-01 lecturer regression"],
      [assistant.supabase, "2051-11-10", "M2-01 scoped Teaching Assistant"],
    ]) {
      const manual = await actor.rpc("create_manual_class_schedule", {
        target_course_id: "10000000-0000-0000-0000-000000000001",
        target_room_id: skillsRoomId,
        target_lecturer_id: lecturerId,
        target_lecturer_2_id: null,
        target_schedule_date: date,
        target_start_time: "07:30",
        target_end_time: "09:30",
        target_note: note,
        target_student_count: 20,
        target_semester: "HK1",
      });
      assert.ifError(manual.error);
      manualScheduleIds.push(manual.data.id);
      batchAAggregateIds.add(manual.data.id);
    }

    await assertManualDomainDenied(
      await lecturer.supabase.rpc("create_manual_class_schedule", {
        target_course_id: "10000000-0000-0000-0000-000000000001",
        target_room_id: basicRoomId,
        target_lecturer_id: lecturerId,
        target_lecturer_2_id: null,
        target_schedule_date: "2051-11-19",
        target_start_time: "07:30",
        target_end_time: "09:30",
        target_note: skillsCourseBasicRoomNote,
        target_student_count: 20,
        target_semester: "HK1",
      }),
      skillsCourseBasicRoomNote,
    );

    await assertManualDomainDenied(
      await lecturer.supabase.rpc("create_manual_class_schedule", {
        target_course_id: basicCourseId,
        target_room_id: skillsRoomId,
        target_lecturer_id: lecturerId,
        target_lecturer_2_id: null,
        target_schedule_date: "2051-11-20",
        target_start_time: "07:30",
        target_end_time: "09:30",
        target_note: basicCourseSkillsRoomNote,
        target_student_count: 20,
        target_semester: "HK1",
      }),
      basicCourseSkillsRoomNote,
    );

    await assertManualDomainDenied(
      await lecturer.supabase.rpc("create_manual_class_schedule", {
        target_course_id: basicCourseId,
        target_room_id: basicRoomId,
        target_lecturer_id: lecturerId,
        target_lecturer_2_id: null,
        target_schedule_date: "2051-11-21",
        target_start_time: "07:30",
        target_end_time: "09:30",
        target_note: basicManualScheduleNote,
        target_student_count: 20,
        target_semester: "HK1",
      }),
      basicManualScheduleNote,
    );

    const manualOutOfScope = await assistant.supabase.rpc(
      "create_manual_class_schedule",
      {
        target_course_id: basicCourseId,
        target_room_id: basicRoomId,
        target_lecturer_id: lecturerId,
        target_lecturer_2_id: null,
        target_schedule_date: "2051-11-11",
        target_start_time: "07:30",
        target_end_time: "09:30",
        target_note: "M2-01 out-of-scope Teaching Assistant",
        target_student_count: 20,
        target_semester: "HK1",
      },
    );
    assert.equal(manualOutOfScope.error?.code, "42501");

    const manualOutOfScopeTarget = await assistant.supabase.rpc(
      "create_manual_class_schedule",
      {
        target_course_id: "10000000-0000-0000-0000-000000000001",
        target_room_id: basicRoomId,
        target_lecturer_id: lecturerId,
        target_lecturer_2_id: null,
        target_schedule_date: "2051-11-12",
        target_start_time: "07:30",
        target_end_time: "09:30",
        target_note: outOfScopeTargetNote,
        target_student_count: 20,
        target_semester: "HK1",
      },
    );
    assert.equal(manualOutOfScopeTarget.error?.code, "42501");
    const outOfScopeTargetSchedule = await service
      .from("class_schedules")
      .select("id")
      .eq("note", outOfScopeTargetNote);
    assert.ifError(outOfScopeTargetSchedule.error);
    assert.equal(outOfScopeTargetSchedule.data.length, 0);

    const manualInvalidLecturer = await assistant.supabase.rpc(
      "create_manual_class_schedule",
      {
        target_course_id: "10000000-0000-0000-0000-000000000001",
        target_room_id: skillsRoomId,
        target_lecturer_id: assistantFixture.id,
        target_lecturer_2_id: null,
        target_schedule_date: "2051-11-13",
        target_start_time: "07:30",
        target_end_time: "09:30",
        target_note: invalidLecturerNote,
        target_student_count: 20,
        target_semester: "HK1",
      },
    );
    assert.equal(manualInvalidLecturer.error?.code, "42501");
    const invalidLecturerSchedule = await service
      .from("class_schedules")
      .select("id")
      .eq("note", invalidLecturerNote);
    assert.ifError(invalidLecturerSchedule.error);
    assert.equal(invalidLecturerSchedule.data.length, 0);

    assert.ifError(
      (
        await service.from("class_schedules").insert({
          id: equipmentScheduleId,
          course_id: "10000000-0000-0000-0000-000000000001",
          course_code_snapshot: "NUR 101",
          course_name_snapshot: "M2 Skills contract fixture",
          room_id: skillsRoomId,
          schedule_date: "2051-11-12",
          start_time: "07:30",
          end_time: "09:30",
          source: "manual",
          schedule_status: "published",
          student_count: 20,
          semester: "HK1",
          created_by: admin.user.id,
          published_by: admin.user.id,
          published_at: new Date().toISOString(),
        })
      ).error,
    );
    assert.ifError(
      (
        await service.from("class_schedules").insert({
          id: equipmentRegressionScheduleId,
          course_id: "10000000-0000-0000-0000-000000000001",
          course_code_snapshot: "NUR 101",
          course_name_snapshot: "M2 Skills regression fixture",
          room_id: skillsRoomId,
          schedule_date: "2051-11-13",
          start_time: "07:30",
          end_time: "09:30",
          source: "manual",
          schedule_status: "published",
          student_count: 20,
          semester: "HK1",
          created_by: admin.user.id,
          published_by: admin.user.id,
          published_at: new Date().toISOString(),
        })
      ).error,
    );
    assert.ifError(
      (
        await service.from("equipment_catalog").insert({
          id: catalogItemId,
          item_name: `M2 equipment ${suffix}`,
          commercial_name: `M2 commercial ${suffix}`,
          unit: "Cái",
        })
      ).error,
    );
    const equipment = await assistant.supabase.rpc(
      "create_equipment_request_with_items",
      {
        target_class_schedule_id: equipmentRegressionScheduleId,
        target_semester: "HK1",
        target_responsible_lecturer_id: lecturerId,
        target_receive_at: "2051-11-13T02:00:00.000Z",
        target_return_at: "2051-11-13T04:00:00.000Z",
        target_note: "M2-02 scoped Teaching Assistant",
        target_late_registration_reason: null,
        target_items: [
          {
            skill_name: "M2 skills",
            catalog_item_id: catalogItemId,
            quantity: 1,
            note: null,
          },
        ],
      },
    );
    assert.ifError(equipment.error);
    equipmentRequestIds.push(equipment.data);
    batchAAggregateIds.add(equipment.data);

    const equipmentNoScope = await equipmentNoScopeAssistant.supabase.rpc(
      "create_equipment_request_with_items",
      {
        target_class_schedule_id: equipmentScheduleId,
        target_semester: "HK1",
        target_responsible_lecturer_id: lecturerId,
        target_receive_at: "2051-11-12T02:00:00.000Z",
        target_return_at: "2051-11-12T04:00:00.000Z",
        target_note: "M2-02 unscoped Teaching Assistant",
        target_late_registration_reason: null,
        target_items: [
          {
            skill_name: "M2 skills",
            catalog_item_id: catalogItemId,
            quantity: 1,
            note: null,
          },
        ],
      },
    );
    assert.equal(equipmentNoScope.error?.code, "42501");

    const equipmentLecturerRegression = await lecturer.supabase.rpc(
      "create_equipment_request_with_items",
      {
        target_class_schedule_id: equipmentScheduleId,
        target_semester: "HK1",
        target_responsible_lecturer_id: lecturerId,
        target_receive_at: "2051-11-12T02:00:00.000Z",
        target_return_at: "2051-11-12T04:00:00.000Z",
        target_note: "M2-02 lecturer regression",
        target_late_registration_reason: null,
        target_items: [
          {
            skill_name: "M2 skills",
            catalog_item_id: catalogItemId,
            quantity: 1,
            note: null,
          },
        ],
      },
    );
    assert.ifError(equipmentLecturerRegression.error);
    equipmentRequestIds.push(equipmentLecturerRegression.data);
    batchAAggregateIds.add(equipmentLecturerRegression.data);

    const basicNoScope = await unscopedAssistant.supabase.rpc(
      "save_basic_medical_registration",
      basicPayload("2051-11-13", "M2-03 Teaching Assistant without scope"),
    );
    assert.equal(basicNoScope.error?.code, "42501");

    const basicNoAccess = await scopedNoAccessAssistant.supabase.rpc(
      "save_basic_medical_registration",
      basicPayload("2051-11-14", "M2-03 Teaching Assistant without access"),
    );
    assert.equal(basicNoAccess.error?.code, "42501");

    const lecturerNoAccess = await lecturer.supabase.rpc(
      "save_basic_medical_registration",
      basicPayload("2051-11-15", "M2-03 Lecturer without access"),
    );
    assert.equal(lecturerNoAccess.error?.code, "42501");

    const basicManager = await admin.supabase.rpc(
      "save_basic_medical_registration",
      basicPayload("2051-11-16", "M2-03 Admin manager regression"),
    );
    assert.ifError(basicManager.error);
    registrationIds.push(basicManager.data);
    batchAAggregateIds.add(basicManager.data);

    assert.ifError(
      (
        await service
          .from("profiles")
          .update({ allow_basic_medical_access: true })
          .eq("id", lecturerId)
      ).error,
    );
    const basicLecturer = await lecturer.supabase.rpc(
      "save_basic_medical_registration",
      basicPayload("2051-11-17", "M2-03 authorized Lecturer"),
    );
    assert.ifError(basicLecturer.error);
    registrationIds.push(basicLecturer.data);
    batchAAggregateIds.add(basicLecturer.data);

    assert.ifError(
      (
        await service
          .from("profiles")
          .update({ allow_basic_medical_access: true })
          .eq("id", assistantFixture.id)
      ).error,
    );
    assert.ifError(
      (
        await service.from("profile_room_types").insert({
          profile_id: assistantFixture.id,
          room_type_id: "40000000-0000-0000-0000-000000000002",
        })
      ).error,
    );
    const basicAllowed = await assistant.supabase.rpc(
      "save_basic_medical_registration",
      basicPayload("2051-11-18", "M2-03 authorized Teaching Assistant"),
    );
    assert.ifError(basicAllowed.error);
    registrationIds.push(basicAllowed.data);
    batchAAggregateIds.add(basicAllowed.data);
  } catch (error) {
    testFailure = error;
    throw error;
  } finally {
    try {
      if (registrationIds.length) {
        const linkedSchedules = await service
          .from("class_schedules")
          .select("id")
          .in("basic_medical_registration_id", registrationIds);
        assert.ifError(linkedSchedules.error);
        for (const { id } of linkedSchedules.data) {
          basicMedicalScheduleIds.push(id);
          batchAAggregateIds.add(id);
        }
      }
      if (equipmentRequestIds.length || registrationIds.length) {
        // Match the S5 fixture convention for immutable, owned test history only.
        // Restore triggers before Basic teardown; never change personnel authority.
        for (const id of [...equipmentRequestIds, ...registrationIds]) {
          assert.match(id, /^[0-9a-f-]{36}$/);
        }
        const ownedRequests =
          equipmentRequestIds.map((id) => `'${id}'`).join(",") || "NULL";
        const ownedRegistrations =
          registrationIds.map((id) => `'${id}'`).join(",") || "NULL";
        const cleanup = spawnSync(
          "docker",
          [
            "exec",
            "-i",
            `supabase_db_${project}`,
            "psql",
            "-X",
            "-U",
            "postgres",
            "-d",
            "postgres",
            "-v",
            "ON_ERROR_STOP=1",
            "-qAt",
          ],
          {
            encoding: "utf8",
            input: `begin;
              do $cleanup$ begin
                if exists(select 1 from public.equipment_preparations where request_id in(${ownedRequests})) then
                  raise exception 'Unexpected preparation in Batch A fixture cleanup';
                end if;
              end; $cleanup$;
              set local session_replication_role=replica;
              delete from public.equipment_preparation_events where request_id in(${ownedRequests});
              delete from public.equipment_request_items where request_id in(${ownedRequests});
              delete from public.equipment_requests where id in(${ownedRequests});
              set local session_replication_role=origin;
              select set_config('app.basic_medical_registration_mutation','true',true);
              delete from public.basic_medical_registration_sessions where registration_id in(${ownedRegistrations});
              delete from public.class_schedules where basic_medical_registration_id in(${ownedRegistrations});
              delete from public.basic_medical_registrations where id in(${ownedRegistrations});
              commit;`,
          },
        );
        assert.equal(cleanup.status, 0, cleanup.stderr);
        for (const id of equipmentRequestIds) batchAAggregateIds.add(id);
      }
      if (manualScheduleIds.length) {
        await service
          .from("class_schedules")
          .delete()
          .in("id", manualScheduleIds);
      }
      await service
        .from("class_schedules")
        .delete()
        .eq("id", equipmentScheduleId);
      await service
        .from("class_schedules")
        .delete()
        .eq("id", equipmentRegressionScheduleId);
      assert.ifError(
        (
          await service
            .from("equipment_catalog")
            .delete()
            .eq("id", catalogItemId)
        ).error,
      );
      assert.ifError(
        (await service.from("courses").delete().eq("id", basicCourseId)).error,
      );
      assert.ifError(
        (await service.from("rooms").delete().eq("id", basicRoomId)).error,
      );
      assert.ifError(
        (await service.from("rooms").delete().eq("id", skillsRoomId)).error,
      );
      for (const userId of testUserIds) {
        assert.ifError((await service.auth.admin.deleteUser(userId)).error);
      }

      const outboxEventIds = new Set();
      const aggregateOutboxEvents = await service
        .from("email_outbox_events")
        .select("id")
        .in("aggregate_id", [...batchAAggregateIds]);
      assert.ifError(aggregateOutboxEvents.error);
      for (const { id } of aggregateOutboxEvents.data) {
        outboxEventIds.add(id);
      }
      for (const registrationId of registrationIds) {
        const registrationOutboxEvents = await service
          .from("email_outbox_events")
          .select("id")
          .like("event_key", `basic_medical:registration:${registrationId}:%`);
        assert.ifError(registrationOutboxEvents.error);
        for (const { id } of registrationOutboxEvents.data) {
          outboxEventIds.add(id);
        }
      }
      if (outboxEventIds.size) {
        for (const eventId of outboxEventIds) {
          const notificationCleanup = await service
            .from("email_notifications")
            .delete()
            .like("dedupe_key", `outbox_notif:${eventId}:%`);
          assert.ifError(notificationCleanup.error);
        }
        const outboxCleanup = await service
          .from("email_outbox_events")
          .delete()
          .in("id", [...outboxEventIds]);
        assert.ifError(outboxCleanup.error);
        const remainingOutboxEvents = await service
          .from("email_outbox_events")
          .select("id")
          .in("id", [...outboxEventIds]);
        assert.ifError(remainingOutboxEvents.error);
        assert.equal(remainingOutboxEvents.data.length, 0);
      }
    } catch (cleanupError) {
      if (!testFailure) throw cleanupError;
    }
  }
});
