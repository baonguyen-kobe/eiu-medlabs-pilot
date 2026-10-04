import nextEnv from "@next/env";
import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";

nextEnv.loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secretKey = process.env.SUPABASE_SECRET_KEY;

function client(key = publishableKey) {
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

const service = client(secretKey);

async function signIn(email, password) {
  const db = client();
  const { error } = await db.auth.signInWithPassword({ email, password });
  assert.ifError(error);
  return db;
}

async function createTemporaryUser({ email, password, title = "" }) {
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { preapproved: true },
    user_metadata: { full_name: "Sixth follow-up test" },
  });
  assert.ifError(error);
  const id = data.user.id;
  const { error: profileError } = await service
    .from("profiles")
    .update({ is_active: true, title })
    .eq("id", id);
  assert.ifError(profileError);
  return id;
}

test("concurrent personnel email reservations allow one winner and keep Auth aligned", async () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const originalEmail = `personnel-race-${suffix}@campus.local`;
  const password = "LocalRace123!";
  const targetId = await createTemporaryUser({
    email: originalEmail,
    password,
  });
  const root = await signIn("admin@campus.local", "LocalAdmin123!");
  try {
    const { data: profile, error: profileError } = await service
      .from("profiles")
      .select("access_version")
      .eq("id", targetId)
      .single();
    assert.ifError(profileError);
    const requestedEmails = [
      `personnel-race-a-${suffix}@campus.local`,
      `personnel-race-b-${suffix}@campus.local`,
    ];
    const begin = (email) =>
      root.rpc("begin_personnel_update", {
        target_profile_id: targetId,
        target_email: email,
        target_full_name: "Sixth follow-up test",
        target_phone: "0900000999",
        target_title: "Giáº£ng viÃªn",
        target_roles: ["lecturer"],
        target_can_import_schedules: false,
        target_room_type_ids: ["40000000-0000-0000-0000-000000000001"],
        target_email_room_type_ids: [],
        target_allow_basic_medical_access: false,
        target_is_active: true,
        target_expected_version: profile.access_version,
      });
    const attempts = await Promise.all(requestedEmails.map(begin));
    const winners = attempts.filter(({ error }) => !error);
    const losers = attempts.filter(({ error }) => error);
    assert.equal(winners.length, 1);
    assert.equal(losers.length, 1);
    assert.match(losers[0].error.message, /PERSONNEL_UPDATE_IN_PROGRESS/);

    const winner = winners[0].data;
    const { error: authError } = await service.auth.admin.updateUserById(
      targetId,
      { email: winner.requested_email },
    );
    assert.ifError(authError);
    const { error: markError } = await root.rpc("mark_personnel_auth_updated", {
      target_operation_id: winner.operation_id,
    });
    assert.ifError(markError);
    const { error: commitError } = await root.rpc("commit_personnel_update", {
      target_operation_id: winner.operation_id,
    });
    assert.ifError(commitError);

    const [{ data: finalProfile }, { data: finalAuth }] = await Promise.all([
      service.from("profiles").select("email").eq("id", targetId).single(),
      service.auth.admin.getUserById(targetId),
    ]);
    assert.equal(finalProfile.email, winner.requested_email);
    assert.equal(finalAuth.user.email, winner.requested_email);
  } finally {
    await service.auth.admin.deleteUser(targetId);
  }
});

test("Nursing-only Staff cannot mutate Basic Medical inventory by table or RPC", async () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const email = `staff-scope-${suffix}@campus.local`;
  const password = "LocalScope123!";
  const userId = await createTemporaryUser({ email, password });
  try {
    const { error: roleError } = await service.from("user_roles").insert({
      user_id: userId,
      role: "staff",
    });
    assert.ifError(roleError);
    const { error: scopeError } = await service
      .from("profile_room_types")
      .insert({
        profile_id: userId,
        room_type_id: "40000000-0000-0000-0000-000000000001",
      });
    assert.ifError(scopeError);
    const scopedStaff = await signIn(email, password);
    const [{ data: inventory }, { data: room }, { data: catalog }] =
      await Promise.all([
        service.from("basic_medical_room_inventory").select("id").limit(1),
        service
          .from("rooms")
          .select("id")
          .eq("room_type_id", "40000000-0000-0000-0000-000000000002")
          .limit(1),
        service.from("basic_medical_equipment_catalog").select("id").limit(1),
      ]);
    if (inventory?.[0]) {
      const { error } = await scopedStaff
        .from("basic_medical_room_inventory")
        .update({ good_quantity: 999 })
        .eq("id", inventory[0].id);
      assert.ok(error);
    }
    if (room?.[0] && catalog?.[0]) {
      const { error } = await scopedStaff.rpc(
        "set_basic_medical_room_inventory",
        {
          target_inventory_id: null,
          target_room_id: room[0].id,
          target_catalog_item_id: catalog[0].id,
          target_total_quantity: 1,
          target_damaged_quantity: 0,
          target_is_active: true,
          target_note: "scope negative test",
        },
      );
      assert.ok(error);
      assert.equal(error.code, "42501");
    }
  } finally {
    await service.auth.admin.deleteUser(userId);
  }
});

test("a title-spoofed non-Lecturer never appears in Basic Medical instructors", async () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const email = `title-spoof-${suffix}@campus.local`;
  const password = "LocalSpoof123!";
  const userId = await createTemporaryUser({
    email,
    password,
    title: "Giáº£ng viÃªn",
  });
  try {
    const { error: roleError } = await service.from("user_roles").insert({
      user_id: userId,
      role: "viewer",
    });
    assert.ifError(roleError);
    const { error: scopeError } = await service
      .from("profile_room_types")
      .insert({
        profile_id: userId,
        room_type_id: "40000000-0000-0000-0000-000000000002",
      });
    assert.ifError(scopeError);
    const root = await signIn("admin@campus.local", "LocalAdmin123!");
    const { data, error } = await root.rpc("list_basic_medical_instructors");
    assert.ifError(error);
    assert.equal(
      data.some(({ id }) => id === userId),
      false,
    );
  } finally {
    await service.auth.admin.deleteUser(userId);
  }
});
