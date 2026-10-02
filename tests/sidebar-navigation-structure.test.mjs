import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceShellSource = await fs.readFile(
  path.resolve(__dirname, "../components/workspace-shell.tsx"),
  "utf8",
);

import ts from "typescript";

// Extract buildNavigation function body to execute and test navigation matrix
function extractBuildNavigation() {
  const startIdx = workspaceShellSource.indexOf("function buildNavigation(");
  const endIdx = workspaceShellSource.indexOf(
    "export function WorkspaceShell(",
  );
  assert.ok(
    startIdx > -1 && endIdx > -1,
    "buildNavigation function found in source",
  );
  const rawFnBody = workspaceShellSource.slice(startIdx, endIdx);
  const transpiled = ts.transpileModule(rawFnBody, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;

  // Mock dependencies for pure execution of buildNavigation
  const mockContext = `
    const LayoutDashboard = "LayoutDashboard";
    const LayoutDashboardSolid = "LayoutDashboardSolid";
    const CalendarDays = "CalendarDays";
    const CalendarDaysSolid = "CalendarDaysSolid";
    const Plus = "Plus";
    const PlusSolid = "PlusSolid";
    const ClipboardList = "ClipboardList";
    const ClipboardListSolid = "ClipboardListSolid";
    const Import = "Import";
    const ImportSolid = "ImportSolid";
    const FileClock = "FileClock";
    const FileClockSolid = "FileClockSolid";
    const GraduationCap = "GraduationCap";
    const GraduationCapSolid = "GraduationCapSolid";
    const PackageCheck = "PackageCheck";
    const PackageCheckSolid = "PackageCheckSolid";
    const Users = "Users";
    const UsersSolid = "UsersSolid";
    const Settings = "Settings";
    const SettingsSolid = "SettingsSolid";

    function canUseSkillsWorkspace(roles, roomTypeCodes) {
      if (roles.includes("admin")) return true;
      if (roomTypeCodes.includes("nursing_skills")) return true;
      return false;
    }

    function canUseBasicMedicalEquipmentRegistration(roles, roomTypeCodes) {
      if (roles.includes("admin")) return true;

      return Boolean(
        roomTypeCodes.includes("basic_medical") &&
        roles.some((role) =>
          ["staff", "lecturer", "teaching_assistant"].includes(role),
        ),
      );
    }

    function canUseEquipmentOperations(roles, roomTypeCodes) {
      return Boolean(
        roles.includes("admin") ||
          (roles.includes("staff") &&
            roomTypeCodes.some((code) =>
              ["nursing_skills", "basic_medical"].includes(code),
            )),
      );
    }

    function canViewBasicMedicalSchedules(roles, roomTypeCodes) {
      if (roles.includes("admin")) return true;
      return roomTypeCodes.includes("basic_medical");
    }

    function canCreateBasicMedicalSchedules(roles, roomTypeCodes, allowBasicMedicalAccess) {
      if (roles.includes("admin")) return true;
      if (roles.includes("staff") && roomTypeCodes.includes("basic_medical")) return true;
      if (roles.some(r => ["lecturer", "teaching_assistant"].includes(r)) && (allowBasicMedicalAccess || roomTypeCodes.includes("basic_medical"))) return true;
      return false;
    }

    function canViewBasicMedicalRegistrations(roles, roomTypeCodes) {
      if (roles.includes("admin")) return true;
      return roomTypeCodes.includes("basic_medical");
    }

    function canImportBasicMedicalSchedules(roles, roomTypeCodes, canImportSchedules) {
      if (roles.includes("admin")) return true;
      return Boolean(canImportSchedules && roomTypeCodes.includes("basic_medical") && roles.some(r => ["staff", "lecturer", "teaching_assistant"].includes(r)));
    }

    function canManageBasicMedicalWorkspace(roles, roomTypeCodes) {
      if (roles.includes("admin")) return true;
      return Boolean(roles.includes("staff") && roomTypeCodes.includes("basic_medical"));
    }

    ${transpiled}
    return buildNavigation;
  `;

  return new Function(mockContext)();
}

const buildNavigation = extractBuildNavigation();

test("Inventory navigation exposes intake to Admin/Staff and opening only to Admin", () => {
  function inventoryDestinations(roles) {
    return buildNavigation(roles, [], false, false, false, false)
      .flatMap((group) => group.items)
      .map((item) => item.href)
      .filter((href) => href.startsWith("/inventory"));
  }

  const admin = inventoryDestinations(["admin"]);
  const staff = inventoryDestinations(["staff"]);
  assert.ok(admin.includes("/inventory/receive"));
  assert.ok(admin.includes("/inventory/opening"));
  assert.ok(staff.includes("/inventory/receive"));
  assert.ok(staff.includes("/inventory/transactions"));
  assert.ok(!staff.includes("/inventory/opening"));
  for (const roles of [[], ["lecturer"], ["teaching_assistant"], ["viewer"]]) {
    assert.deepEqual(inventoryDestinations(roles), []);
  }
});

test("Sidebar Navigation: Lecturer (Nursing skills) gets correct groups, labels, and order", () => {
  const nav = buildNavigation(
    ["lecturer"],
    ["nursing_skills"],
    false,
    true, // canImportSchedules
    false,
    false,
  );

  const groupLabels = nav.map((g) => g.label);
  assert.deepEqual(groupLabels, [
    "Kỹ năng Điều dưỡng",
    "Tạo phiếu",
    "Quản lý lớp",
  ]);

  // Group 2 — Tạo phiếu
  assert.deepEqual(
    nav[1].items.map((i) => ({ label: i.label, href: i.href })),
    [
      { label: "Tạo lịch Skills lab", href: "/schedule-entry/new" },
      { label: "Đăng ký thiết bị", href: "/equipment/register" },
      { label: "Import lịch Skills lab", href: "/schedule-entry/import" },
      { label: "Lịch sử import", href: "/imports" },
    ],
  );

  // Group 3 — Quản lý lớp (Lecturer sees Lớp của tôi)
  assert.deepEqual(
    nav[2].items.map((i) => ({ label: i.label, href: i.href })),
    [
      { label: "Lớp đang mở", href: "/classes/open" },
      { label: "Lớp của tôi", href: "/classes/mine" },
      { label: "Phiếu thiết bị của tôi", href: "/equipment/mine" },
    ],
  );
});

test("Sidebar Navigation: Viewer (Basic Medical only) sees conditional 'Thiết bị Y cơ sở' at tab=rooms and no manage catalog", () => {
  const nav = buildNavigation(
    ["viewer"],
    ["basic_medical"],
    false,
    false,
    false,
    false,
  );

  const groupLabels = nav.map((g) => g.label);
  assert.deepEqual(groupLabels, ["Y cơ sở"]);

  assert.deepEqual(
    nav[0].items.map((i) => ({ label: i.label, href: i.href })),
    [
      { label: "Lịch Y cơ sở", href: "/basic-medical/schedules" },
      { label: "Phiếu Y cơ sở", href: "/basic-medical/registrations" },
      { label: "Thiết bị Y cơ sở", href: "/basic-medical/equipment?tab=rooms" },
    ],
  );

  // Ensure 'Danh mục TB Y cơ sở' is NOT present
  const allHrefs = nav.flatMap((g) => g.items.map((i) => i.href));
  assert.ok(!allHrefs.includes("/basic-medical/equipment"));
  assert.ok(
    !nav
      .flatMap((group) => group.items)
      .some((item) => item.label === "Đăng ký thiết bị"),
  );
});

test("Sidebar Navigation: Basic Medical-only lecturer enters the Basic Medical equipment registration workspace", () => {
  const nav = buildNavigation(
    ["lecturer"],
    ["basic_medical"],
    false,
    false,
    false,
    false,
  );
  const items = nav.flatMap((group) => group.items);
  const equipmentEntries = items.filter(
    (item) => item.label === "Đăng ký thiết bị",
  );

  assert.deepEqual(equipmentEntries, [
    {
      label: "Đăng ký thiết bị",
      href: "/basic-medical/equipment-requests",
      icon: "ClipboardList",
      activeIcon: "ClipboardListSolid",
    },
  ]);
  assert.ok(!items.some((item) => item.label === "Tạo lịch Skills lab"));
  assert.ok(!items.some((item) => item.label === "Import lịch Skills lab"));
  assert.ok(!items.some((item) => item.label === "Phiếu thiết bị của tôi"));
});

test("Sidebar Navigation: Staff with Basic Medical scope sees 'Danh mục TB Y cơ sở' under Quản trị", () => {
  const nav = buildNavigation(
    ["staff"],
    ["basic_medical"],
    false,
    true,
    false,
    false,
  );

  const groupLabels = nav.map((g) => g.label);
  assert.ok(groupLabels.includes("Y cơ sở"));
  assert.ok(groupLabels.includes("Quản trị"));

  const quanTriGroup = nav.find((g) => g.label === "Quản trị");
  assert.deepEqual(
    quanTriGroup.items.map((i) => ({ label: i.label, href: i.href })),
    [{ label: "Danh mục TB Y cơ sở", href: "/basic-medical/equipment" }],
  );
});

test("Sidebar Navigation: Basic Medical-only Staff receives the unified operations destination only", () => {
  const nav = buildNavigation(
    ["staff"],
    ["basic_medical"],
    false,
    false,
    false,
    false,
  );
  const management = nav.find((group) => group.label === "Quản lý phòng");
  assert.deepEqual(
    management.items.map((item) => ({ label: item.label, href: item.href })),
    [{ label: "Phiếu thiết bị", href: "/equipment/requests" }],
  );
  assert.equal(
    nav
      .flatMap((group) => group.items)
      .filter((item) => item.href === "/equipment/requests").length,
    1,
  );
});

test("Sidebar Navigation: No empty groups rendered when user has restricted permissions", () => {
  const nav = buildNavigation(
    ["viewer"],
    ["nursing_skills"],
    false,
    false,
    false,
    false,
  );

  // Viewer in nursing skills should only see Group 1
  const groupLabels = nav.map((g) => g.label);
  assert.deepEqual(groupLabels, ["Kỹ năng Điều dưỡng"]);
  for (const group of nav) {
    assert.ok(group.items.length > 0, `Group ${group.label} must have items`);
  }
});
