import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  passwordRecoveryRedirectUrl,
  resolveApplicationOrigin,
  safeInternalPath,
} from "../lib/application-url.mjs";
import { resolvePasswordChangeState } from "../lib/password-state.mjs";

test("internal redirect paths keep their route, query and hash", () => {
  for (const path of [
    "/dashboard",
    "/reset-password",
    "/equipment/register?mode=copy&request=1",
    "/classes/open#today",
  ]) {
    assert.equal(safeInternalPath(path, "/dashboard"), path);
  }
});

test("redirect targets that can leave the application use the fallback", () => {
  const origin = "https://medlabs.example.edu.vn";

  for (const target of [
    null,
    undefined,
    "",
    "dashboard",
    "https://review.example/path",
    "javascript:alert(1)",
    "//review.example/path",
    "/\\review.example/path",
    "\\\\review.example/path",
    "/\t/review.example/path",
    "/\n/review.example/path",
    "/.//review.example/path",
    "/.\\/review.example/path",
    "/x/..//review.example/path",
    "/\\[",
  ]) {
    assert.equal(safeInternalPath(target, "/dashboard"), "/dashboard");
  }

  // Encoded separators stay inside the path, so they may pass unchanged.
  const encoded = safeInternalPath("/%2F/review.example/path", "/dashboard");
  assert.equal(new URL(encoded, origin).origin, origin);
});

test("the Auth callback resolves its redirect through the shared guard", async () => {
  const source = await readFile(
    new URL("../app/auth/callback/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /safeInternalPath\(\s*requestUrl\.searchParams\.get\("next"\)/,
  );
  assert.doesNotMatch(source, /requestedNext/);
});

test("password recovery uses the canonical production application origin", () => {
  assert.equal(
    passwordRecoveryRedirectUrl({
      NEXT_PUBLIC_APP_URL: "https://medlabs.example.edu.vn/workspace/",
      NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
      NODE_ENV: "production",
      VERCEL_ENV: "production",
    }),
    "https://medlabs.example.edu.vn/auth/callback?next=/reset-password",
  );
});

test("password recovery uses a loopback origin only for a local Supabase runtime", () => {
  assert.equal(
    resolveApplicationOrigin(
      {
        NEXT_PUBLIC_APP_URL: "https://production.example.edu.vn",
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
        NODE_ENV: "development",
      },
      "http://localhost:3000",
    ),
    "http://localhost:3000",
  );
});

test("a hosted runtime without a safe canonical origin fails closed", () => {
  for (const env of [
    {
      NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
      NODE_ENV: "production",
    },
    {
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
      NODE_ENV: "production",
      VERCEL_ENV: "production",
    },
  ]) {
    assert.throws(
      () => passwordRecoveryRedirectUrl(env),
      /APPLICATION_ORIGIN_UNAVAILABLE/,
    );
  }
});

test("a hosted runtime never trusts a loopback request origin", () => {
  const hosted = {
    NEXT_PUBLIC_APP_URL: "https://medlabs.example.edu.vn",
    NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
    NODE_ENV: "production",
  };

  assert.equal(
    passwordRecoveryRedirectUrl(hosted, "http://localhost:3000"),
    "https://medlabs.example.edu.vn/auth/callback?next=/reset-password",
  );
  assert.throws(
    () =>
      passwordRecoveryRedirectUrl(
        {
          NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
          NODE_ENV: "production",
        },
        "http://localhost:3000",
      ),
    /APPLICATION_ORIGIN_UNAVAILABLE/,
  );
});

test("password-state policy allows only a verified boolean false and blocks forced, errors, and missing state", () => {
  assert.equal(
    resolvePasswordChangeState({
      data: { must_change_password: false },
      error: null,
    }),
    false,
  );
  assert.equal(
    resolvePasswordChangeState({
      data: { must_change_password: true },
      error: null,
    }),
    true,
  );
  for (const result of [
    { data: null, error: { message: "profile lookup failed" } },
    { data: null, error: null },
    { data: {}, error: null },
  ]) {
    assert.throws(
      () => resolvePasswordChangeState(result),
      /PASSWORD_STATE_UNAVAILABLE/,
    );
  }
});

test("viewer resolves password state from its authoritative profile read", async () => {
  const source = await readFile(
    new URL("../lib/viewer.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /can_manage_email_notifications, must_change_password/);
  assert.match(source, /resolvePasswordChangeState\(profileResult\)/);
  assert.doesNotMatch(source, /redirectIfPasswordChangeRequired/);
});
