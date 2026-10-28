import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const root = new URL("..", import.meta.url);

function readWorkflow(name) {
  return readFileSync(
    new URL(`../.github/workflows/${name}`, import.meta.url),
    "utf8",
  ).replace(/\r\n/g, "\n");
}

test("CI creates an isolated Supabase workdir without mutating local preview config", () => {
  const previewConfigPath = new URL("../supabase/config.toml", import.meta.url);
  const previewConfig = readFileSync(previewConfigPath, "utf8");
  const target = mkdtempSync(join(tmpdir(), "lich-truc-app-ci-"));

  try {
    const result = spawnSync(
      process.execPath,
      ["scripts/prepare-ci-supabase-workdir.mjs", target],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);

    const ciConfig = readFileSync(
      join(target, "supabase", "config.toml"),
      "utf8",
    );
    assert.equal(existsSync(join(target, "supabase", ".temp")), false);
    assert.match(ciConfig, /project_id = "lich-truc-app-ci"/);
    for (const port of [
      55420, 55421, 55422, 55423, 55424, 55427, 55429, 55883,
    ]) {
      assert.match(
        ciConfig,
        new RegExp(`(?:port|shadow_port|inspector_port) = ${port}`),
      );
    }
    assert.match(previewConfig, /project_id = "eiu-medlabs-pilot"/);
    assert.match(previewConfig, /port = 58321/);
    assert.match(
      previewConfig,
      /\[auth\.rate_limit\][\s\S]*sign_in_sign_ups = 30/,
    );
    assert.match(
      ciConfig,
      /\[auth\.rate_limit\][\s\S]*sign_in_sign_ups = 1000/,
    );
    assert.equal(readFileSync(previewConfigPath, "utf8"), previewConfig);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("CI directs each local Supabase operation to the disposable workdir", () => {
  const workflow = readWorkflow("ci.yml");

  assert.match(workflow, /mktemp -d "\$RUNNER_TEMP\/lich-truc-app-ci\.XXXXXX"/);
  for (const command of ["start", "db reset", "status", "db lint", "test db"]) {
    assert.match(
      workflow,
      new RegExp(`supabase ${command} --workdir "\\$CI_SUPABASE_WORKDIR"`),
    );
  }
  assert.match(
    workflow,
    /seed-local-users\.ps1 -SupabaseWorkdir "\$env:CI_SUPABASE_WORKDIR"/,
  );
  assert.equal(
    workflow.split("seed-local-users.ps1 -SupabaseWorkdir").length - 1,
    2,
    "both fixture seed steps must receive the CI workdir",
  );
});

test("CI serializes the shared runtime and seed only observes its workdir", () => {
  const workflow = readWorkflow("ci.yml");
  const seedScript = readFileSync(
    new URL("../scripts/seed-local-users.ps1", import.meta.url),
    "utf8",
  );

  assert.match(
    workflow,
    /concurrency:\n  group: ci-supabase-runtime\n  cancel-in-progress: false/,
  );
  assert.match(
    seedScript,
    /\[string\]\$SupabaseWorkdir = \$env:CI_SUPABASE_WORKDIR/,
  );
  assert.match(
    seedScript,
    /supabase status --workdir \$SupabaseWorkdir -o env/,
  );
  assert.doesNotMatch(seedScript, /supabase stop/);
});

test("CI retires only its stale Supabase runtime and always cleans it up", () => {
  const workflow = readWorkflow("ci.yml");
  const ciStopCommand =
    "npx --no-install supabase stop --project-id lich-truc-app-ci --no-backup";

  assert.equal(
    workflow.split(ciStopCommand).length - 1,
    2,
    "CI must stop the CI-only runtime before start and at job end",
  );
  assert.match(
    workflow,
    /- name: Clean up isolated CI Supabase runtime\n        if: always\(\)/,
  );
  assert.match(
    workflow,
    /case "\$CI_SUPABASE_WORKDIR" in\n              "\$RUNNER_TEMP"\/lich-truc-app-ci\.\*\)/,
  );
  assert.match(workflow, /rm -rf -- "\$CI_SUPABASE_WORKDIR"/);
  assert.doesNotMatch(workflow, /supabase stop --all/);
  assert.doesNotMatch(
    workflow,
    /supabase stop --project-id lich-truc-app(?:\s|$)/,
  );
  assert.doesNotMatch(
    workflow,
    /\bdocker\s+(?:system\s+prune|container\s+(?:prune|rm)|rm)\b/,
  );
});

test("PR mode runs only the required browser gates and builds once", () => {
  const workflow = readWorkflow("ci.yml");
  const packageJson = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );

  assert.match(
    workflow,
    /workflow_call:\n    inputs:\n      e2e_mode:\n        default: required/,
  );
  assert.match(
    workflow,
    /- name: Run required stable end-to-end suite\n        if: \$\{\{ inputs\.e2e_mode != 'full' \}\}\n        run: npm run test:e2e:required/,
  );
  assert.doesNotMatch(workflow, /npm run test:e2e:critical/);
  assert.match(
    workflow,
    /- name: Verify Basic Medical evidence flag-off behavior\n        run: npm run test:e2e:evidence-off/,
  );
  assert.match(
    workflow,
    /- name: Build production bundle\n        run: npm run build/,
  );
  assert.match(
    workflow,
    /- name: Smoke-test production bundle\n        run: npm run test:e2e:production-smoke:run/,
  );
  assert.equal(
    (workflow.match(/run: npm run build/g) ?? []).length,
    1,
    "CI must build the production bundle exactly once",
  );
  assert.equal(
    packageJson.scripts["test:e2e:required"],
    "playwright test tests/e2e/accessibility-smoke.spec.ts",
  );
  assert.equal(
    packageJson.scripts["test:e2e:production-smoke:run"],
    "playwright test --config=playwright.production.config.ts",
  );
  assert.equal(packageJson.scripts["test:e2e:critical"], undefined);
});

test("Full E2E is manual-only and reuses the isolated CI workflow", () => {
  const ciWorkflow = readWorkflow("ci.yml");
  const fullWorkflow = readWorkflow("full-e2e.yml");

  assert.match(fullWorkflow, /^on:\n  workflow_dispatch:\s*$/m);
  assert.doesNotMatch(fullWorkflow, /^  schedule:/m);
  assert.doesNotMatch(fullWorkflow, /cron:/);
  assert.doesNotMatch(fullWorkflow, /^  pull_request:/m);
  assert.doesNotMatch(fullWorkflow, /^  push:/m);
  assert.match(
    fullWorkflow,
    /uses: \.\/\.github\/workflows\/ci\.yml\n    with:\n      e2e_mode: full/,
  );
  assert.match(
    ciWorkflow,
    /timeout-minutes: \$\{\{ inputs\.e2e_mode == 'full' && 90 \|\| 30 \}\}/,
  );
  assert.match(
    ciWorkflow,
    /- name: Run full local end-to-end suite\n        if: \$\{\{ inputs\.e2e_mode == 'full' \}\}\n        run: npm run test:e2e:full-local/,
  );
  assert.match(
    ciWorkflow,
    /- name: Upload Full E2E failure artifacts\n        if: \$\{\{ failure\(\) && inputs\.e2e_mode == 'full' \}\}/,
  );
  assert.match(
    ciWorkflow,
    /path: test-results\/\n          if-no-files-found: ignore/,
  );
  assert.match(ciWorkflow, /retention-days: 7/);
  assert.match(
    ciWorkflow,
    /- name: Clean up isolated CI Supabase runtime\n        if: always\(\)/,
  );
  assert.doesNotMatch(fullWorkflow, /(?:preview|production|vercel\.app)/i);
});

test("Full local configuration excludes specialist E2E and keeps retries disabled", () => {
  const packageJson = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  const fullConfig = readFileSync(
    new URL("../playwright.full-local.config.ts", import.meta.url),
    "utf8",
  );

  assert.equal(
    packageJson.scripts["test:e2e:full-local"],
    "playwright test --config playwright.full-local.config.ts",
  );
  assert.equal(packageJson.scripts["test:e2e"], "npm run test:e2e:full-local");
  for (const spec of [
    "basic-medical-evidence-pdf-off.spec.ts",
    "email-matrix-delivery.spec.ts",
    "pr19-compatibility-bridge.spec.ts",
    "production-admin-login.spec.ts",
    "production-bundle-smoke.spec.ts",
    "production-personnel-permissions.spec.ts",
    "ui-v2-visual-capture.spec.ts",
  ]) {
    assert.ok(
      fullConfig.includes(`"${spec}"`),
      `Full local config must exclude ${spec}`,
    );
  }
  for (const config of [
    "playwright.config.ts",
    "playwright.evidence-off.config.ts",
    "playwright.production.config.ts",
    "playwright.full-local.config.ts",
  ]) {
    assert.doesNotMatch(
      readFileSync(new URL(`../${config}`, import.meta.url), "utf8"),
      /^\s*retries\s*:/m,
      `${config} must not set global Playwright retries`,
    );
  }
});
