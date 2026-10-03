import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { assertLocalSupabaseTarget } from "./helpers/local-test-safety.mjs";
import { equipmentUpdateItems } from "./helpers/equipment-update-fixture.mjs";

const envText = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const localEnv = Object.fromEntries(
  envText
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const [key, ...value] = line.split("=");
      return [key, value.join("=")];
    }),
);
assertLocalSupabaseTarget(localEnv.NEXT_PUBLIC_SUPABASE_URL);

function localSql(sql) {
  const listed = spawnSync(
    "docker",
    [
      "ps",
      "--filter",
      `label=com.supabase.cli.project=${process.env.SUPABASE_LOCAL_PROJECT_ID ?? "lich-truc-app"}`,
      "--format",
      "{{.Names}}",
    ],
    { encoding: "utf8" },
  );
  const databases = listed.stdout
    .split(/\r?\n/)
    .filter((name) => name.startsWith("supabase_db_"));
  if (listed.status !== 0 || databases.length !== 1) {
    throw new Error("REFUSING_AMBIGUOUS_LOCAL_SUPABASE_DATABASE");
  }
  const result = spawnSync(
    "docker",
    [
      "exec",
      "-i",
      databases[0],
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-At",
    ],
    { input: sql, encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim();
}

async function signIn(email, password) {
  const client = createClient(
    localEnv.NEXT_PUBLIC_SUPABASE_URL,
    localEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password,
  });
  assert.ifError(error);
  return { client, user: data.user };
}

function items(catalogId, quantity = 1, note = "") {
  return [{ catalog_item_id: catalogId, quantity, note }];
}

function hasRoomTypeScope(profileId, roomTypeCode) {
  return (
    localSql(`
      select exists(
        select 1
        from public.profile_room_types as scope
        join public.room_types as room_type on room_type.id = scope.room_type_id
        where scope.profile_id = '${profileId}'
          and room_type.code = '${roomTypeCode}'
      );
    `) === "t"
  );
}

test("Basic Medical equipment edit preserves its source and stays domain-local", async () => {
  const fixture = {
    course: crypto.randomUUID(),
    room: crypto.randomUUID(),
    registrationA: crypto.randomUUID(),
    scheduleA: crypto.randomUUID(),
    sessionA: crypto.randomUUID(),
    registrationB: crypto.randomUUID(),
    scheduleB: crypto.randomUUID(),
    sessionB: crypto.randomUUID(),
    registrationLate: crypto.randomUUID(),
    scheduleLate: crypto.randomUUID(),
    sessionLate: crypto.randomUUID(),
    catalog: crypto.randomUUID(),
    inactiveCatalog: crypto.randomUUID(),
  };
  const owner = await signIn("giangvien@campus.local", "LocalLecturer123!");
  const manager = await signIn("admin@campus.local", "LocalAdmin123!");
  const unrelated = await signIn("trogiang@campus.local", "LocalAssistant123!");
  const ownerId = owner.user.id;
  const teachingLecturerId = localSql(
    "select id from auth.users where email = 'importer@campus.local'",
  );
  const basicMedicalStaffId = localSql(
    "select id from auth.users where email = 'staff@campus.local'",
  );
  const skillsOnlyStaffId = localSql(
    "select id from auth.users where email = 'dieuphoi@eiu.edu.vn'",
  );
  const ownerHadBasicMedicalScope = hasRoomTypeScope(ownerId, "basic_medical");
  const teachingLecturerHadBasicMedicalScope = hasRoomTypeScope(
    teachingLecturerId,
    "basic_medical",
  );
  const basicMedicalStaffHadBasicMedicalScope = hasRoomTypeScope(
    basicMedicalStaffId,
    "basic_medical",
  );
  const skillsOnlyStaffHadSkillsScope = hasRoomTypeScope(
    skillsOnlyStaffId,
    "nursing_skills",
  );
  const removeTemporaryScopes = [
    !ownerHadBasicMedicalScope
      ? `delete from public.profile_room_types where profile_id = '${ownerId}' and room_type_id = (select id from public.room_types where code = 'basic_medical');`
      : "",
    !teachingLecturerHadBasicMedicalScope
      ? `delete from public.profile_room_types where profile_id = '${teachingLecturerId}' and room_type_id = (select id from public.room_types where code = 'basic_medical');`
      : "",
    !basicMedicalStaffHadBasicMedicalScope
      ? `delete from public.profile_room_types where profile_id = '${basicMedicalStaffId}' and room_type_id = (select id from public.room_types where code = 'basic_medical');`
      : "",
    !skillsOnlyStaffHadSkillsScope
      ? `delete from public.profile_room_types where profile_id = '${skillsOnlyStaffId}' and room_type_id = (select id from public.room_types where code = 'nursing_skills');`
      : "",
  ].join("\n");
  const deliveryModeBefore =
    localSql(
      "select delivery_mode from public.email_delivery_settings where setting_key = 'primary'",
    ) || "off";
  const lateSlot = JSON.parse(
    localSql(`
      with now_hcm as (
        select clock_timestamp() at time zone 'Asia/Ho_Chi_Minh' as value
      )
      select json_build_object(
        'date', case
          when value::time < time '08:45' then value::date
          when value::time < time '10:45' then value::date
          when value::time < time '13:45' then value::date
          when value::time < time '15:45' then value::date
          else value::date + 1
        end,
        'receive_time', case
          when value::time < time '08:45' then '09:00'
          when value::time < time '10:45' then '11:00'
          when value::time < time '13:45' then '14:00'
          when value::time < time '15:45' then '16:00'
          else '09:00'
        end
      )::text
      from now_hcm;
    `),
  );
  const skillsCatalogId = "30000000-0000-0000-0000-000000000001";
  let requestA;
  let requestB;
  let requestLate;

  try {
    localSql(`
      begin;
      select set_config('app.basic_medical_registration_mutation', 'true', true);
      update public.email_delivery_settings
      set delivery_mode = 'off'
      where setting_key = 'primary';
      insert into public.profile_room_types (profile_id, room_type_id)
      select scoped.profile_id, room_type.id
      from (values
        ('${ownerId}'::uuid),
        ('${teachingLecturerId}'::uuid),
        ('${basicMedicalStaffId}'::uuid)
      ) as scoped(profile_id)
      cross join public.room_types as room_type
      where room_type.code = 'basic_medical'
      on conflict do nothing;
      insert into public.profile_room_types (profile_id, room_type_id)
      select '${skillsOnlyStaffId}', id
      from public.room_types
      where code = 'nursing_skills'
      on conflict do nothing;
      insert into public.courses (id, course_code, course_name, room_type_id, is_active)
      select '${fixture.course}', 'BM-EDIT', 'Basic Medical edit test', id, true
      from public.room_types where code = 'basic_medical';
      insert into public.rooms (id, room_code, building_code, room_name, room_type_id, capacity, is_active)
      select '${fixture.room}', 'BM-EDIT', 'TEST', 'Basic Medical edit', id, 20, true
      from public.room_types where code = 'basic_medical';
      insert into public.basic_medical_registrations
        (id, academic_year, semester, start_date, end_date, course_id, room_id, student_count, registrant_id, responsible_lecturer_id, created_by)
      values
        ('${fixture.registrationA}', '2099-2100', 'HK1', '2099-11-22', '2099-11-22', '${fixture.course}', '${fixture.room}', 20, '${ownerId}', '${teachingLecturerId}', '${ownerId}'),
        ('${fixture.registrationB}', '2099-2100', 'HK1', '2099-11-23', '2099-11-23', '${fixture.course}', '${fixture.room}', 20, '${ownerId}', '${teachingLecturerId}', '${ownerId}'),
        ('${fixture.registrationLate}', '2099-2100', 'HK1', '${lateSlot.date}', '${lateSlot.date}', '${fixture.course}', '${fixture.room}', 20, '${ownerId}', '${teachingLecturerId}', '${ownerId}');
      insert into public.class_schedules
        (id, course_id, course_code_snapshot, course_name_snapshot, room_id, lecturer_id, schedule_date, start_time, end_time, source, schedule_status, student_count, basic_medical_registration_id, created_by, published_by, published_at)
      values
        ('${fixture.scheduleA}', '${fixture.course}', 'BM-EDIT', 'Basic Medical edit test', '${fixture.room}', '${teachingLecturerId}', '2099-11-22', '09:00', '11:00', 'manual', 'published', 20, '${fixture.registrationA}', '${ownerId}', '${ownerId}', clock_timestamp()),
        ('${fixture.scheduleB}', '${fixture.course}', 'BM-EDIT', 'Basic Medical copy target', '${fixture.room}', '${teachingLecturerId}', '2099-11-23', '09:00', '11:00', 'manual', 'published', 20, '${fixture.registrationB}', '${ownerId}', '${ownerId}', clock_timestamp()),
        ('${fixture.scheduleLate}', '${fixture.course}', 'BM-EDIT', 'Basic Medical late email', '${fixture.room}', '${teachingLecturerId}', '${lateSlot.date}', '09:00', '11:00', 'manual', 'published', 20, '${fixture.registrationLate}', '${ownerId}', '${ownerId}', clock_timestamp());
      insert into public.basic_medical_registration_sessions (id, registration_id, class_schedule_id, lesson_title, teaching_lecturer_id, session_number)
      values
        ('${fixture.sessionA}', '${fixture.registrationA}', '${fixture.scheduleA}', 'Bài nguồn không đổi', '${teachingLecturerId}', 1),
        ('${fixture.sessionB}', '${fixture.registrationB}', '${fixture.scheduleB}', 'Bài đích không đổi', '${teachingLecturerId}', 1),
        ('${fixture.sessionLate}', '${fixture.registrationLate}', '${fixture.scheduleLate}', 'Bài đăng ký trễ', '${teachingLecturerId}', 1);
      insert into public.basic_medical_equipment_catalog (id, item_name, commercial_name, unit, is_active)
      values
        ('${fixture.catalog}', 'Thiết bị edit', 'Thiết bị edit thương mại', 'Cái', true),
        ('${fixture.inactiveCatalog}', 'Thiết bị không hoạt động', 'Thiết bị không hoạt động TM', 'Cái', false);
      commit;
    `);

    const createA = await owner.client.rpc(
      "create_equipment_request_with_items",
      {
        target_class_schedule_id: fixture.scheduleA,
        target_semester: "HK1",
        target_responsible_lecturer_id: null,
        target_receive_at: "2099-11-22T02:00:00.000Z",
        target_return_at: "2099-11-22T09:00:00.000Z",
        target_note: "ghi chú nguồn",
        target_late_registration_reason: null,
        target_items: [
          {
            skill_name: "ignored",
            catalog_item_id: fixture.catalog,
            quantity: 1,
            note: "một",
          },
        ],
      },
    );
    assert.ifError(createA.error);
    requestA = createA.data;
    assert.ok(requestA, "EDIT-1: owner creates the Basic Medical request");
    const initialEditItems = await equipmentUpdateItems(
      owner.client,
      requestA,
      items(fixture.catalog, 3, "ba"),
    );

    const updateA = await owner.client.rpc(
      "update_basic_medical_equipment_request_content",
      {
        target_request_id: requestA,
        target_receive_at: "2099-11-22T04:00:00.000Z",
        target_return_at: "2099-11-22T09:00:00.000Z",
        target_note: "owner adjusted",
        target_late_registration_reason: null,
        target_items: initialEditItems,
      },
    );
    assert.ifError(updateA.error);
    assert.equal(updateA.data, requestA, "EDIT-1 preserves request ID");

    localSql(`
      begin;
      set local session_replication_role = replica;
      update public.equipment_requests set status = 'preparing' where id = '${requestA}';
      commit;
    `);
    const preparing = await owner.client.rpc(
      "update_basic_medical_equipment_request_content",
      {
        target_request_id: requestA,
        target_receive_at: "2099-11-22T04:00:00.000Z",
        target_return_at: "2099-11-22T09:00:00.000Z",
        target_note: "preparing adjusted",
        target_late_registration_reason: null,
        target_items: await equipmentUpdateItems(
          owner.client,
          requestA,
          items(fixture.catalog, 4, "bốn"),
        ),
      },
    );
    assert.ifError(preparing.error, "EDIT-2 preparing stays editable");

    const forbidden = await unrelated.client.rpc(
      "update_basic_medical_equipment_request_content",
      {
        target_request_id: requestA,
        target_receive_at: "2099-11-22T04:00:00.000Z",
        target_return_at: "2099-11-22T09:00:00.000Z",
        target_note: "forbidden",
        target_late_registration_reason: null,
        target_items: items(fixture.catalog),
      },
    );
    assert.ok(forbidden.error, "EDIT-3 unrelated lecturer/TA cannot edit");

    const managerUpdate = await manager.client.rpc(
      "update_basic_medical_equipment_request_content",
      {
        target_request_id: requestA,
        target_receive_at: "2099-11-22T04:00:00.000Z",
        target_return_at: "2099-11-22T09:00:00.000Z",
        target_note: "manager adjusted",
        target_late_registration_reason: null,
        target_items: await equipmentUpdateItems(
          manager.client,
          requestA,
          items(fixture.catalog, 5, "năm"),
        ),
      },
    );
    assert.ifError(
      managerUpdate.error,
      "EDIT-4 Basic Medical manager can edit",
    );

    const { data: persisted, error: persistedError } = await manager.client
      .from("equipment_requests")
      .select(
        "source_identity_id,class_schedule_id,request_domain,note,preparation_revision,equipment_request_items(id,registered_quantity,skill_name,quantity,catalog_item_id,basic_medical_catalog_item_id,note)",
      )
      .eq("id", requestA)
      .single();
    assert.ifError(persistedError);
    assert.equal(
      persisted.equipment_request_items[0].id,
      initialEditItems[0].id,
      "repeated Basic Medical saves preserve the original line identity",
    );
    assert.equal(
      persisted.equipment_request_items[0].registered_quantity,
      1,
      "Basic Medical edits preserve the registered baseline",
    );
    assert.equal(
      persisted.equipment_request_items[0].quantity,
      5,
      "Basic Medical current quantity remains editable",
    );
    assert.ok(
      persisted.preparation_revision > initialEditItems[0].expected_revision,
    );
    const staleEdit = await owner.client.rpc(
      "update_basic_medical_equipment_request_content",
      {
        target_request_id: requestA,
        target_receive_at: "2099-11-22T04:00:00.000Z",
        target_return_at: "2099-11-22T09:00:00.000Z",
        target_note: "Stale editor must not overwrite manager",
        target_late_registration_reason: null,
        target_items: initialEditItems,
      },
    );
    assert.equal(
      staleEdit.error?.code,
      "23505",
      "stale Basic Medical save rejects atomically",
    );
    assert.equal(
      persisted.source_identity_id,
      fixture.sessionA,
      "EDIT-6 source identity is immutable",
    );
    assert.equal(
      persisted.class_schedule_id,
      fixture.scheduleA,
      "EDIT-7 class schedule is immutable",
    );
    assert.equal(persisted.request_domain, "basic_medical");
    assert.equal(
      persisted.equipment_request_items[0].basic_medical_catalog_item_id,
      fixture.catalog,
      "EDIT-10 stores Basic Medical catalog only",
    );
    assert.equal(
      persisted.equipment_request_items[0].catalog_item_id,
      null,
      "EDIT-8 never stores Skills catalog",
    );
    assert.equal(
      persisted.equipment_request_items[0].skill_name,
      "Bài nguồn không đổi",
      "EDIT-11 preserves lesson title",
    );

    const skillsCatalog = await manager.client.rpc(
      "update_basic_medical_equipment_request_content",
      {
        target_request_id: requestA,
        target_receive_at: "2099-11-22T04:00:00.000Z",
        target_return_at: "2099-11-22T09:00:00.000Z",
        target_note: "skills catalog",
        target_late_registration_reason: null,
        target_items: items(skillsCatalogId),
      },
    );
    assert.ok(skillsCatalog.error, "EDIT-8 rejects Skills catalog IDs");
    const inactiveCatalog = await manager.client.rpc(
      "update_basic_medical_equipment_request_content",
      {
        target_request_id: requestA,
        target_receive_at: "2099-11-22T04:00:00.000Z",
        target_return_at: "2099-11-22T09:00:00.000Z",
        target_note: "inactive catalog",
        target_late_registration_reason: null,
        target_items: items(fixture.inactiveCatalog),
      },
    );
    assert.ok(
      inactiveCatalog.error,
      "EDIT-9 rejects inactive Basic Medical catalog IDs",
    );

    for (const status of [
      "handed_over",
      "returned",
      "completed",
      "cancelled",
    ]) {
      localSql(`
        begin;
        set local session_replication_role = replica;
        update public.equipment_requests set status = '${status}' where id = '${requestA}';
        commit;
      `);
      const locked = await owner.client.rpc(
        "update_basic_medical_equipment_request_content",
        {
          target_request_id: requestA,
          target_receive_at: "2099-11-22T04:00:00.000Z",
          target_return_at: "2099-11-22T09:00:00.000Z",
          target_note: status,
          target_late_registration_reason: null,
          target_items: items(fixture.catalog),
        },
      );
      assert.ok(locked.error, `EDIT-5 ${status} cannot edit`);
    }
    localSql(`
      begin;
      set local session_replication_role = replica;
      update public.equipment_requests set status = 'preparing' where id = '${requestA}';
      commit;
    `);

    const createB = await owner.client.rpc(
      "create_equipment_request_with_items",
      {
        target_class_schedule_id: fixture.scheduleB,
        target_semester: "HK1",
        target_responsible_lecturer_id: null,
        target_receive_at: "2099-11-23T02:00:00.000Z",
        target_return_at: "2099-11-23T09:00:00.000Z",
        target_note: "copy destination",
        target_late_registration_reason: null,
        target_items: [
          {
            skill_name: "ignored",
            catalog_item_id: fixture.catalog,
            quantity: 1,
            note: "copy",
          },
        ],
      },
    );
    assert.ifError(createB.error);
    requestB = createB.data;
    const duplicateDestination = await owner.client.rpc(
      "create_equipment_request_with_items",
      {
        target_class_schedule_id: fixture.scheduleB,
        target_semester: "HK1",
        target_responsible_lecturer_id: null,
        target_receive_at: "2099-11-23T02:00:00.000Z",
        target_return_at: "2099-11-23T09:00:00.000Z",
        target_note: "duplicate",
        target_late_registration_reason: null,
        target_items: [
          {
            skill_name: "ignored",
            catalog_item_id: fixture.catalog,
            quantity: 1,
            note: "duplicate",
          },
        ],
      },
    );
    assert.ok(
      duplicateDestination.error,
      "COPY keeps destination session uniqueness through create RPC",
    );

    const lateCreate = await owner.client.rpc(
      "create_equipment_request_with_items",
      {
        target_class_schedule_id: fixture.scheduleLate,
        target_semester: "HK1",
        target_responsible_lecturer_id: null,
        target_receive_at: `${lateSlot.date}T${lateSlot.receive_time}:00+07:00`,
        target_return_at: `${lateSlot.date}T16:00:00+07:00`,
        target_note: "late email event",
        target_late_registration_reason: "E2E late approval coverage",
        target_items: [
          {
            skill_name: "ignored",
            catalog_item_id: fixture.catalog,
            quantity: 1,
            note: "late",
          },
        ],
      },
    );
    assert.ifError(lateCreate.error);
    requestLate = lateCreate.data;
    const lateOutbox = JSON.parse(
      localSql(`
        select coalesce(json_agg(json_build_object(
          'event_type', event_type,
          'request_domain', payload->>'request_domain'
        )), '[]'::json)::text
        from public.email_outbox_events
        where aggregate_id = '${requestLate}';
      `),
    );
    assert.deepEqual(
      lateOutbox,
      [
        {
          event_type: "late_approval_requested",
          request_domain: "basic_medical",
        },
      ],
      "EMAIL-BM-02 late create enqueues only the late approval event",
    );
    const lateEdit = await owner.client.rpc(
      "update_basic_medical_equipment_request_content",
      {
        target_request_id: requestLate,
        target_receive_at: `${lateSlot.date}T${lateSlot.receive_time}:00+07:00`,
        target_return_at: `${lateSlot.date}T16:00:00+07:00`,
        target_note: "late email adjustment",
        target_late_registration_reason: "E2E late approval coverage",
        target_items: await equipmentUpdateItems(
          owner.client,
          requestLate,
          items(fixture.catalog, 2, "late adjusted"),
        ),
      },
    );
    assert.ifError(lateEdit.error);
    const lateEditEvents = JSON.parse(
      localSql(`
        select coalesce(json_agg(event_type order by created_at), '[]'::json)::text
        from public.email_outbox_events
        where aggregate_id = '${requestLate}';
      `),
    );
    assert.deepEqual(
      lateEditEvents,
      ["late_approval_requested"],
      "EMAIL-BM-05 pending late edit does not enqueue a duplicate late email",
    );
    assert.ok(
      Number(
        localSql(`
          select count(*)
          from public.user_notifications
          where entity_id = '${requestLate}'
            and notification_type = 'late_pending_updated';
        `),
      ) > 0,
      "EMAIL-BM-05 pending late edit creates in-app stakeholder notifications",
    );

    const outboxRows = JSON.parse(
      localSql(`
        select coalesce(json_agg(json_build_object(
          'id', id,
          'domain', domain,
          'event_type', event_type,
          'delivery_mode', delivery_mode_at_event,
          'request_domain', payload->>'request_domain',
          'lab_type', payload->>'lab_type',
          'item_name', payload #>> '{items,0,item_name}',
          'commercial_name', payload #>> '{items,0,commercial_name}',
          'unit', payload #>> '{items,0,unit}',
          'recipients', recipients
        )), '[]'::json)::text
        from public.email_outbox_events
        where aggregate_id = '${requestA}';
      `),
    );
    assert.ok(
      outboxRows.some((row) => row.event_type === "created"),
      "EMAIL-BM-01 normal Basic Medical create enqueues created",
    );
    assert.ok(
      outboxRows.some((row) => row.event_type === "updated"),
      "EMAIL-BM-04 normal Basic Medical edit enqueues updated",
    );
    for (const row of outboxRows) {
      assert.equal(row.domain, "equipment_request");
      assert.equal(row.delivery_mode, "off", "EMAIL-BM-15 uses delivery OFF");
      assert.equal(row.request_domain, "basic_medical", "EMAIL-BM-06");
      assert.equal(row.lab_type, "Y cơ sở", "EMAIL-BM-07");
      assert.equal(row.item_name, "Thiết bị edit", "EMAIL-BM-08");
      assert.equal(
        row.commercial_name,
        "Thiết bị edit thương mại",
        "EMAIL-BM-09",
      );
      assert.equal(row.unit, "Cái", "EMAIL-BM-09");
      const recipientEmails = row.recipients.map(
        (recipient) => recipient.recipient_email,
      );
      assert.ok(
        recipientEmails.includes("importer@campus.local"),
        "EMAIL-BM-13 teaching lecturer receives the responsible audience",
      );
      assert.ok(
        recipientEmails.includes("admin@campus.local"),
        "EMAIL-BM-10 admin receives the manager audience",
      );
      assert.ok(
        recipientEmails.includes("staff@campus.local"),
        "EMAIL-BM-11 Basic Medical-scoped staff receives the manager audience",
      );
      assert.ok(
        !recipientEmails.includes("dieuphoi@eiu.edu.vn"),
        "EMAIL-BM-12 Skills-only staff is excluded from Basic Medical events",
      );
      assert.equal(
        recipientEmails.length,
        new Set(recipientEmails).size,
        "EMAIL-BM-14 recipient emails are deduplicated",
      );
    }
    const copyOutbox = JSON.parse(
      localSql(`
        select coalesce(json_agg(json_build_object(
          'event_type', event_type,
          'request_domain', payload->>'request_domain'
        )), '[]'::json)::text
        from public.email_outbox_events
        where aggregate_id = '${requestB}';
      `),
    );
    assert.ok(
      copyOutbox.some(
        (row) =>
          row.event_type === "created" &&
          row.request_domain === "basic_medical",
      ),
      "EMAIL-BM-03 copy uses the guarded create path and enqueues its destination event",
    );
    localSql("select public.process_email_outbox_events(100)");
    const notifications = JSON.parse(
      localSql(`
        select coalesce(json_agg(json_build_object(
          'status', status,
          'delivery_mode', delivery_mode_at_enqueue
        )), '[]'::json)::text
        from public.email_notifications
        where payload->>'request_id' in ('${requestA}', '${requestB}', '${requestLate}');
      `),
    );
    assert.ok(
      notifications.length > 0,
      "EMAIL-BM-15 creates local notifications",
    );
    assert.ok(
      notifications.every(
        (notification) =>
          notification.status === "suppressed" &&
          notification.delivery_mode === "off",
      ),
      "EMAIL-BM-15 delivery OFF suppresses external delivery",
    );
  } finally {
    localSql(`
      begin;
      set local session_replication_role = replica;
      delete from public.user_notifications
      where entity_id in ('${requestA ?? "00000000-0000-0000-0000-000000000000"}', '${requestB ?? "00000000-0000-0000-0000-000000000000"}', '${requestLate ?? "00000000-0000-0000-0000-000000000000"}');
      delete from public.email_notifications
      where payload->>'request_id' in ('${requestA ?? "00000000-0000-0000-0000-000000000000"}', '${requestB ?? "00000000-0000-0000-0000-000000000000"}', '${requestLate ?? "00000000-0000-0000-0000-000000000000"}');
      delete from public.email_outbox_events
      where aggregate_id in ('${requestA ?? "00000000-0000-0000-0000-000000000000"}', '${requestB ?? "00000000-0000-0000-0000-000000000000"}', '${requestLate ?? "00000000-0000-0000-0000-000000000000"}');
      delete from public.equipment_request_items where request_id in ('${requestA ?? "00000000-0000-0000-0000-000000000000"}', '${requestB ?? "00000000-0000-0000-0000-000000000000"}', '${requestLate ?? "00000000-0000-0000-0000-000000000000"}');
      delete from public.equipment_requests where id in ('${requestA ?? "00000000-0000-0000-0000-000000000000"}', '${requestB ?? "00000000-0000-0000-0000-000000000000"}', '${requestLate ?? "00000000-0000-0000-0000-000000000000"}');
      delete from public.basic_medical_registration_sessions where id in ('${fixture.sessionA}', '${fixture.sessionB}', '${fixture.sessionLate}');
      delete from public.class_schedules where id in ('${fixture.scheduleA}', '${fixture.scheduleB}', '${fixture.scheduleLate}');
      delete from public.basic_medical_registrations where id in ('${fixture.registrationA}', '${fixture.registrationB}', '${fixture.registrationLate}');
      delete from public.basic_medical_equipment_catalog where id in ('${fixture.catalog}', '${fixture.inactiveCatalog}');
      delete from public.rooms where id = '${fixture.room}';
      delete from public.courses where id = '${fixture.course}';
      ${removeTemporaryScopes}
      update public.email_delivery_settings
      set delivery_mode = '${deliveryModeBefore}'
      where setting_key = 'primary';
      commit;
    `);
    assert.equal(
      hasRoomTypeScope(ownerId, "basic_medical"),
      ownerHadBasicMedicalScope,
      "fixture cleanup preserves the owner's original Basic Medical scope",
    );
    assert.equal(
      hasRoomTypeScope(teachingLecturerId, "basic_medical"),
      teachingLecturerHadBasicMedicalScope,
      "fixture cleanup preserves the teaching lecturer's original Basic Medical scope",
    );
    assert.equal(
      hasRoomTypeScope(basicMedicalStaffId, "basic_medical"),
      basicMedicalStaffHadBasicMedicalScope,
      "fixture cleanup preserves the staff member's original Basic Medical scope",
    );
    assert.equal(
      hasRoomTypeScope(skillsOnlyStaffId, "nursing_skills"),
      skillsOnlyStaffHadSkillsScope,
      "fixture cleanup preserves the Skills-only staff member's original scope",
    );
  }
});
