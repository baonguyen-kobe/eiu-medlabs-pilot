import nextEnv from "@next/env";
import { spawnSync } from "node:child_process";
import { expect, test, type Locator } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { clickUntilState } from "./helpers/interaction-readiness";

nextEnv.loadEnvConfig(process.cwd());

const serviceDb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

function localSql(sql: string) {
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
  if (result.status !== 0) throw new Error(result.stderr || "LOCAL_SQL_FAILED");
  return result.stdout.trim();
}

async function loginAsAdmin(page: import("@playwright/test").Page) {
  await page.goto("/login");

  const email = page.locator('input[name="email"]');
  const password = page.locator('input[name="password"]');
  const submit = page.locator('button[type="submit"]');

  await clickUntilState(
    submit,
    () =>
      expect(page).toHaveURL(/\/(dashboard|basic-medical\/schedules)/, {
        timeout: 1_000,
      }),
    async () => {
      await email.fill(process.env.E2E_ADMIN_EMAIL ?? "admin@campus.local");
      await password.fill(process.env.E2E_ADMIN_PASSWORD ?? "LocalAdmin123!");
    },
  );
}

async function assertTableRightEdge(
  page: import("@playwright/test").Page,
  selectors: {
    shell: string;
    viewport: string;
    table: string;
    ownsVisualShell?: boolean;
  },
) {
  const geometry = await page.evaluate((current) => {
    const shell = document.querySelector<HTMLElement>(current.shell);
    const viewport = document.querySelector<HTMLElement>(current.viewport);
    const table = document.querySelector<HTMLTableElement>(current.table);
    const lastHeader = table?.querySelector("thead th:last-child");
    const lastBody = table?.querySelector("tbody td:last-child");
    if (!shell || !viewport || !table || !lastHeader || !lastBody) {
      throw new Error("Expected table shell hierarchy is missing");
    }
    viewport.scrollLeft = viewport.scrollWidth;
    const rect = (element: Element) => {
      const value = element.getBoundingClientRect();
      return { right: value.right, width: value.width };
    };
    const style = getComputedStyle(viewport);
    // Kho lists scroll vertically inside their card; that scrollbar is not table.
    const scrollbar = viewport.offsetWidth - viewport.clientWidth;
    return {
      scrollbar,
      shell: rect(shell),
      viewport: rect(viewport),
      table: rect(table),
      lastHeader: rect(lastHeader),
      lastBody: rect(lastBody),
      viewportClientWidth: viewport.clientWidth,
      scrollbarGutter: style.scrollbarGutter,
      borderTopWidth: style.borderTopWidth,
      borderRadius: style.borderRadius,
      overflowX: style.overflowX,
      paddingRight: style.paddingRight,
      backgroundColor: style.backgroundColor,
    };
  }, selectors);

  expect(geometry.scrollbarGutter).toBe("auto");
  expect(geometry.overflowX).toBe("auto");
  expect(geometry.paddingRight).toBe("0px");
  if (selectors.ownsVisualShell) {
    expect(geometry.borderTopWidth).toBe("1px");
    expect(geometry.borderRadius).not.toBe("0px");
    expect(geometry.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
  } else {
    expect(geometry.borderTopWidth).toBe("0px");
    expect(geometry.borderRadius).toBe("0px");
    expect(geometry.backgroundColor).toBe("rgba(0, 0, 0, 0)");
  }
  expect(geometry.table.width).toBeGreaterThanOrEqual(
    geometry.viewportClientWidth - 1,
  );
  // Border width plus subpixel rounding only; this must not mask a gutter.
  expect(
    Math.abs(geometry.shell.right - geometry.viewport.right),
  ).toBeLessThanOrEqual(2);
  expect(
    Math.abs(
      geometry.viewport.right - geometry.scrollbar - geometry.table.right,
    ),
  ).toBeLessThanOrEqual(2);
  expect(
    Math.abs(geometry.table.right - geometry.lastHeader.right),
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(geometry.table.right - geometry.lastBody.right),
  ).toBeLessThanOrEqual(1);
}

type CellInset = {
  label: string;
  left: number;
  right: number;
  tdPaddingLeft: string;
  tdPaddingRight: string;
  childBoxSizing: string;
  childMaxInlineSize: string;
  childMaxWidth: string;
  childPaddingInlineStart: string;
  childPaddingInlineEnd: string;
  childTextAlign: string;
  childWidth: number;
  tdContentWidth: number;
  wrapperWidth: number | null;
  marginLeft: string;
  marginRight: string;
};

async function measureTableCellInset(
  locator: Locator,
  label: string,
  textOnly = false,
): Promise<CellInset> {
  return locator.evaluate(
    (element, { label: currentLabel, textOnly: isTextOnly }) => {
      const cell = element.closest("td");
      if (!cell) throw new Error(`Missing table cell for ${currentLabel}`);

      const textRange = (() => {
        if (!isTextOnly) return null;
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        const textNode = walker.nextNode();
        if (!textNode?.textContent?.trim()) {
          throw new Error(`Missing visible text for ${currentLabel}`);
        }
        const range = document.createRange();
        range.selectNodeContents(textNode);
        return range;
      })();
      const targetRect = (textRange ?? element).getBoundingClientRect();
      const cellRect = cell.getBoundingClientRect();
      const childStyle = getComputedStyle(element);
      const immediateWrapper = element.parentElement;
      const wrapperRect =
        immediateWrapper && immediateWrapper !== cell
          ? immediateWrapper.getBoundingClientRect()
          : null;
      const cellStyle = getComputedStyle(cell);

      return {
        label: currentLabel,
        left: targetRect.left - cellRect.left,
        right: cellRect.right - targetRect.right,
        tdPaddingLeft: cellStyle.paddingLeft,
        tdPaddingRight: cellStyle.paddingRight,
        childBoxSizing: childStyle.boxSizing,
        childMaxInlineSize: childStyle.maxInlineSize,
        childMaxWidth: childStyle.maxWidth,
        childPaddingInlineStart: childStyle.paddingInlineStart,
        childPaddingInlineEnd: childStyle.paddingInlineEnd,
        childTextAlign: childStyle.textAlign,
        childWidth: targetRect.width,
        tdContentWidth:
          cell.clientWidth -
          Number.parseFloat(cellStyle.paddingLeft) -
          Number.parseFloat(cellStyle.paddingRight),
        wrapperWidth: wrapperRect?.width ?? null,
        marginLeft: childStyle.marginLeft,
        marginRight: childStyle.marginRight,
      };
    },
    { label, textOnly },
  );
}

function expectSafeTableInset(inset: CellInset) {
  // One pixel allows borders and sub-pixel rounding but not a content-box leak.
  expect(inset.left, `${inset.label} left inset`).toBeGreaterThanOrEqual(15);
  expect(inset.right, `${inset.label} right inset`).toBeGreaterThanOrEqual(15);
  expect(inset.tdPaddingLeft).toBe("16px");
  expect(inset.tdPaddingRight).toBe("16px");
  expect(inset.childBoxSizing).toBe("border-box");
  expect(inset.marginLeft).toBe("0px");
  expect(inset.marginRight).toBe("0px");
}

async function createDashboardScheduleFixture() {
  const scheduleId = crypto.randomUUID();
  const [courseResult, roomResult, principalsResult] = await Promise.all([
    serviceDb
      .from("courses")
      .select("id,course_code,course_name")
      .eq("is_active", true)
      .limit(1)
      .single(),
    serviceDb
      .from("rooms")
      .select("id")
      .eq("is_active", true)
      .limit(1)
      .single(),
    serviceDb
      .from("system_security_principals")
      .select("root_admin_id")
      .eq("singleton", true)
      .single(),
  ]);
  if (
    courseResult.error ||
    roomResult.error ||
    principalsResult.error ||
    !courseResult.data ||
    !roomResult.data ||
    !principalsResult.data
  ) {
    throw new Error("Dashboard table fixture prerequisites are missing");
  }
  const { data: lecturer, error: lecturerError } = await serviceDb
    .from("user_roles")
    .select("user_id")
    .eq("role", "lecturer")
    .neq("user_id", principalsResult.data.root_admin_id)
    .limit(1)
    .single();
  if (lecturerError || !lecturer) {
    throw lecturerError ?? new Error("Dashboard lecturer fixture is missing");
  }
  const date = new Date();
  date.setDate(date.getDate() + 1);
  const { error } = await serviceDb.from("class_schedules").insert({
    id: scheduleId,
    course_id: courseResult.data.id,
    course_code_snapshot: courseResult.data.course_code,
    course_name_snapshot: courseResult.data.course_name,
    room_id: roomResult.data.id,
    lecturer_id: lecturer.user_id,
    schedule_date: date.toISOString().slice(0, 10),
    start_time: "08:00",
    end_time: "10:00",
    source: "manual",
    schedule_status: "published",
    student_count: 1,
    created_by: lecturer.user_id,
    published_by: lecturer.user_id,
    published_at: new Date().toISOString(),
  });
  if (error) throw error;
  return scheduleId;
}

test("form-table controls and text retain the Master visible 16px safe inset", async ({
  page,
}, testInfo) => {
  const scheduleId = await createDashboardScheduleFixture();
  const date = new Date();
  date.setDate(date.getDate() + 1);
  const scheduleDate = date.toISOString().slice(0, 10);

  try {
    await loginAsAdmin(page);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/classes/open?period=day&date=${scheduleDate}`, {
      waitUntil: "networkidle",
    });

    const row = page.locator(".class-registration-table tbody tr").first();
    await expect(row.locator('input[type="date"]')).toBeVisible();
    const cells = row.locator("td");
    const measurements = await Promise.all([
      measureTableCellInset(row.locator('input[type="date"]'), "Date"),
      // The time picker is a custom control; its input carries the insets.
      measureTableCellInset(
        row.locator(".time-picker-input").first(),
        "Start time",
      ),
      measureTableCellInset(
        row.locator(".time-picker-input").nth(1),
        "End time",
      ),
      measureTableCellInset(cells.nth(4).locator("select"), "Room select"),
      measureTableCellInset(
        row.locator('input[type="number"]'),
        "Student count",
      ),
      // Editable rows show the course code as a select, not plain text.
      measureTableCellInset(cells.nth(2).locator("select"), "Course code"),
      measureTableCellInset(cells.nth(3), "Course name", true),
    ]);

    for (const measurement of measurements) expectSafeTableInset(measurement);
    const controls = measurements.slice(0, 5);
    for (const measurement of controls) {
      expect(
        measurement.childMaxInlineSize === "100%" ||
          measurement.childMaxWidth === "100%",
        `${measurement.label} is capped to its cell`,
      ).toBe(true);
      if (measurement.wrapperWidth !== null) {
        expect(measurement.wrapperWidth).toBeLessThanOrEqual(
          measurement.tdContentWidth + 1,
        );
      }
    }
    const nativeAffordances = new Set(["Date", "Room select"]);
    // The custom time picker keeps its clock button outside the input, so the
    // input itself needs no end clearance.
    const customPickers = new Set(["Start time", "End time"]);
    for (const measurement of controls) {
      expect(
        Number.parseFloat(measurement.childPaddingInlineStart),
        `${measurement.label} has an internal start inset`,
      ).toBeGreaterThanOrEqual(10);
      if (!customPickers.has(measurement.label)) {
        expect(
          Number.parseFloat(measurement.childPaddingInlineEnd),
          `${measurement.label} has an internal end inset`,
        ).toBeGreaterThanOrEqual(10);
      }
      if (nativeAffordances.has(measurement.label)) {
        expect(
          Number.parseFloat(measurement.childPaddingInlineEnd),
          `${measurement.label} reserves end clearance for its native affordance`,
        ).toBeGreaterThanOrEqual(20);
      }
    }
    const studentCount = measurements.find(
      (measurement) => measurement.label === "Student count",
    );
    expect(studentCount).toBeDefined();
    expect(
      Math.abs((studentCount?.left ?? 0) - (studentCount?.right ?? 0)),
      "Student count control is visually centered in its table cell",
    ).toBeLessThanOrEqual(1);
    expect(studentCount?.childTextAlign).toBe("center");
    const lecturerMetrics = await row
      .locator(".searchable-combobox-control")
      .first()
      .evaluate((control) => {
        const rect = control.getBoundingClientRect();
        const icons = control.querySelectorAll("svg");
        const search = icons[0]?.getBoundingClientRect();
        const chevron = icons[1]?.getBoundingClientRect();
        if (!search || !chevron)
          throw new Error("Missing lecturer control icons");
        const style = getComputedStyle(control);
        return {
          paddingInlineStart: style.paddingInlineStart,
          paddingInlineEnd: style.paddingInlineEnd,
          searchLeft: search.left - rect.left,
          chevronRight: rect.right - chevron.right,
        };
      });
    expect(
      Number.parseFloat(lecturerMetrics.paddingInlineStart),
    ).toBeGreaterThanOrEqual(10);
    expect(
      Number.parseFloat(lecturerMetrics.paddingInlineEnd),
    ).toBeGreaterThanOrEqual(10);
    expect(lecturerMetrics.searchLeft).toBeGreaterThanOrEqual(10);
    expect(lecturerMetrics.chevronRight).toBeGreaterThanOrEqual(10);
    await page.setViewportSize({ width: 1100, height: 900 });
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true);
    await testInfo.attach("table-body-safe-insets.json", {
      body: JSON.stringify(measurements, null, 2),
      contentType: "application/json",
    });
  } finally {
    await serviceDb.from("class_schedules").delete().eq("id", scheduleId);
  }
});

test("Basic Medical registrations and sessions use shared master-grid anchors", async ({
  page,
}) => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const ids = Object.fromEntries(
    ["course", "room", "registration", "schedule", "session"].map((name) => [
      name,
      crypto.randomUUID(),
    ]),
  ) as Record<string, string>;
  const courseCode = `GRID-${suffix}`;
  const rootId = localSql(
    "select root_admin_id from public.system_security_principals where singleton;",
  );
  const lecturerId = localSql(
    "select id from public.profiles where email = 'giangvien@campus.local' limit 1;",
  );

  try {
    localSql(`
      begin;
      select set_config('app.basic_medical_registration_mutation', 'true', true);
      insert into public.courses (id, course_code, course_name, room_type_id, is_active)
      select '${ids.course}', '${courseCode}', 'Grid fixture ${suffix}', id, true
      from public.room_types where code = 'basic_medical';
      insert into public.rooms (id, room_code, building_code, room_name, room_type_id, capacity, is_active)
      select '${ids.room}', 'GRID-${suffix}', 'E2E', 'Grid room ${suffix}', id, 20, true
      from public.room_types where code = 'basic_medical';
      insert into public.basic_medical_registrations
        (id, academic_year, semester, start_date, end_date, course_id, room_id, student_count, registrant_id, responsible_lecturer_id, created_by)
      values ('${ids.registration}', '2045-2046', 'HK1', '2045-08-11', '2045-08-11', '${ids.course}', '${ids.room}', 10, '${rootId}', '${lecturerId}', '${rootId}');
      insert into public.class_schedules
        (id, course_id, course_code_snapshot, course_name_snapshot, room_id, lecturer_id, schedule_date, start_time, end_time, source, schedule_status, student_count, basic_medical_registration_id, created_by, published_by, published_at)
      values ('${ids.schedule}', '${ids.course}', '${courseCode}', 'Grid lesson ${suffix}', '${ids.room}', '${lecturerId}', '2045-08-11', '08:00', '10:00', 'manual', 'published', 10, '${ids.registration}', '${rootId}', '${rootId}', clock_timestamp());
      insert into public.basic_medical_registration_sessions (id, registration_id, class_schedule_id, lesson_title, teaching_lecturer_id, session_number)
      values ('${ids.session}', '${ids.registration}', '${ids.schedule}', 'Grid lesson ${suffix}', '${lecturerId}', 1);
      commit;
    `);

    await loginAsAdmin(page);
    await page.setViewportSize({ width: 1620, height: 1000 });
    await page.goto("/basic-medical/registrations", {
      waitUntil: "networkidle",
    });

    const registrationTable = page.locator(".basic-medical-registration-table");
    const firstRegistrationRow = registrationTable
      .locator(".equipment-request-table-row")
      .filter({ hasText: courseCode });
    await expect(firstRegistrationRow).toBeVisible();
    await firstRegistrationRow.locator("td:nth-child(2)").click();

    const sessionTable = page.locator(".basic-medical-session-table");
    await expect(sessionTable).toBeVisible();
    const geometry = await page.evaluate(() => {
      const registrationTable = document.querySelector<HTMLTableElement>(
        ".basic-medical-registration-table",
      );
      const sessionTable = document.querySelector<HTMLTableElement>(
        ".basic-medical-session-table",
      );
      const cancel = registrationTable?.querySelector<HTMLElement>(
        ".basic-medical-registration-detail-action .button",
      );
      const registrationStatus = registrationTable?.querySelector<HTMLElement>(
        ".equipment-request-table-row td:nth-child(5) .request-status",
      );
      const actionStack = sessionTable?.querySelector<HTMLElement>(
        ".basic-medical-session-action-stack",
      );
      const lecturerCell = sessionTable?.querySelector<HTMLElement>(
        "tbody tr td:nth-child(5)",
      );
      const registrantLabel = registrationTable?.querySelector<HTMLElement>(
        ".basic-medical-registration-detail-registrant > span",
      );
      const responsibleLabel = registrationTable?.querySelector<HTMLElement>(
        ".basic-medical-registration-detail-responsible > span",
      );
      const registrationHeadings = registrationTable
        ? [
            ...registrationTable.querySelectorAll<HTMLElement>(
              ":scope > thead th",
            ),
          ]
        : [];
      const sessionHeadings = sessionTable
        ? [...sessionTable.querySelectorAll<HTMLElement>(":scope > thead th")]
        : [];
      const [
        registrationCourseHeading,
        registrationTimeHeading,
        registrationRoomHeading,
        registrationSessionsHeading,
        registrationStatusHeading,
      ] = registrationHeadings;
      const [
        sessionIndexHeading,
        sessionDateHeading,
        sessionTimeHeading,
        sessionLessonHeading,
        sessionLecturerHeading,
        sessionStatusHeading,
      ] = sessionHeadings;
      // Skip the lecturer-edit button that sits beside the status badge.
      const sessionAction = [
        ...(actionStack?.querySelectorAll<HTMLElement>("button") ?? []),
      ].find((button) => !button.closest(".basic-medical-session-status-row"));
      const sessionStatus =
        actionStack?.querySelector<HTMLElement>(".request-status");
      if (
        !registrationTable ||
        !sessionTable ||
        !cancel ||
        !registrationStatus ||
        !actionStack ||
        !lecturerCell ||
        !registrantLabel ||
        !responsibleLabel ||
        !registrationCourseHeading ||
        !registrationTimeHeading ||
        !registrationRoomHeading ||
        !registrationSessionsHeading ||
        !registrationStatusHeading ||
        !sessionIndexHeading ||
        !sessionDateHeading ||
        !sessionTimeHeading ||
        !sessionLessonHeading ||
        !sessionLecturerHeading ||
        !sessionStatusHeading ||
        !sessionAction ||
        !sessionStatus
      ) {
        throw new Error("Basic Medical layout controls are missing");
      }
      const textLeft = (element: HTMLElement) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        return range.getBoundingClientRect().left;
      };
      const widths = (table: HTMLTableElement) =>
        [
          ...table.querySelectorAll<HTMLTableCellElement>(":scope > thead th"),
        ].map((cell) => cell.getBoundingClientRect().width);
      const left = (element: HTMLElement) =>
        element.getBoundingClientRect().left;

      return {
        registrationWidths: widths(registrationTable),
        sessionWidths: widths(sessionTable),
        summaryAnchorDeltas: {
          registrantToPeriod: Math.abs(
            textLeft(registrantLabel) - textLeft(registrationTimeHeading),
          ),
          responsibleToRoom: Math.abs(
            textLeft(responsibleLabel) - textLeft(registrationRoomHeading),
          ),
        },
        sharedAnchorPositions: {
          registrationTime: left(registrationTimeHeading),
          sessionTime: left(sessionTimeHeading),
          registrationRoom: left(registrationRoomHeading),
          sessionLesson: left(sessionLessonHeading),
          registrationSessions: left(registrationSessionsHeading),
          sessionLecturer: left(sessionLecturerHeading),
          registrationStatus: left(registrationStatusHeading),
          sessionStatus: left(sessionStatusHeading),
        },
        sharedAnchorDeltas: {
          time: Math.abs(
            left(registrationTimeHeading) - left(sessionTimeHeading),
          ),
          room: Math.abs(
            left(registrationRoomHeading) - left(sessionLessonHeading),
          ),
          sessions: Math.abs(
            left(registrationSessionsHeading) - left(sessionLecturerHeading),
          ),
          status: Math.abs(
            left(registrationStatusHeading) - left(sessionStatusHeading),
          ),
        },
        sessionFirstTrackDelta: Math.abs(
          sessionIndexHeading.getBoundingClientRect().width +
            sessionDateHeading.getBoundingClientRect().width -
            (registrationCourseHeading.getBoundingClientRect().width - 18),
        ),
        contentAnchorDeltas: {
          lecturerToHeading: Math.abs(
            textLeft(lecturerCell) - textLeft(sessionLecturerHeading),
          ),
          registrationActionToStatus: Math.abs(
            left(cancel) - textLeft(registrationStatusHeading),
          ),
          sessionActionToStatus: Math.abs(
            left(sessionAction) - textLeft(sessionStatusHeading),
          ),
          registrationBadgeToStatus: Math.abs(
            left(registrationStatus) - textLeft(registrationStatusHeading),
          ),
          sessionBadgeToStatus: Math.abs(
            left(sessionStatus) - textLeft(sessionStatusHeading),
          ),
        },
        pageOverflow: document.documentElement.scrollWidth > window.innerWidth,
      };
    });

    const [course, period, room, sessions, status] =
      geometry.registrationWidths;
    expect(course).toBeGreaterThan(200);
    expect(period).toBeGreaterThan(200);
    expect(room).toBeGreaterThan(200);
    expect(sessions).toBeGreaterThan(250);
    expect(status).toBeGreaterThan(200);
    expect(geometry.summaryAnchorDeltas.registrantToPeriod).toBeLessThanOrEqual(
      1,
    );
    expect(geometry.summaryAnchorDeltas.responsibleToRoom).toBeLessThanOrEqual(
      1,
    );
    expect(geometry.sharedAnchorDeltas.time).toBeLessThanOrEqual(2);
    expect(geometry.sharedAnchorDeltas.room).toBeLessThanOrEqual(2);
    expect(geometry.sharedAnchorDeltas.sessions).toBeLessThanOrEqual(2);
    expect(geometry.sharedAnchorDeltas.status).toBeLessThanOrEqual(2);
    expect(geometry.sessionFirstTrackDelta).toBeLessThanOrEqual(2);
    expect(geometry.contentAnchorDeltas.lecturerToHeading).toBeLessThanOrEqual(
      1,
    );
    expect(
      geometry.contentAnchorDeltas.registrationActionToStatus,
    ).toBeLessThanOrEqual(1);
    expect(
      geometry.contentAnchorDeltas.sessionActionToStatus,
    ).toBeLessThanOrEqual(1);
    expect(
      geometry.contentAnchorDeltas.registrationBadgeToStatus,
    ).toBeLessThanOrEqual(1);
    expect(
      geometry.contentAnchorDeltas.sessionBadgeToStatus,
    ).toBeLessThanOrEqual(1);

    const [index, date, time, lesson, lecturer, sessionStatus] =
      geometry.sessionWidths;
    expect(index).toBeLessThan(date);
    expect(time).toBeCloseTo(period, 0);
    expect(lesson).toBeCloseTo(room, 0);
    expect(lecturer).toBeCloseTo(sessions, 0);
    expect(sessionStatus).toBeCloseTo(status, 0);
    expect(geometry.pageOverflow).toBe(false);

    await firstRegistrationRow.locator("td:nth-child(3)").click();
    await expect(sessionTable).toBeHidden();
    await firstRegistrationRow.locator("td:nth-child(4)").click();
    await expect(sessionTable).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/basic-medical/registrations", {
      waitUntil: "networkidle",
    });
    await expect(firstRegistrationRow).toBeVisible();
    const mobileGeometry = await page.evaluate(() => {
      const viewport = document.querySelector<HTMLElement>(
        ".basic-medical-registration-panel > .responsive-table",
      );
      if (!viewport) {
        throw new Error("Basic Medical responsive table viewport is missing");
      }
      const table = viewport.querySelector<HTMLElement>("table");
      const firstCell = table?.querySelector<HTMLElement>(
        "tbody td[data-label]",
      );
      return {
        // UI Master 0A.4: at 920 px and below rows are labelled records,
        // no field hidden and no sideways scroll (review 2026-11-19).
        localScroll: viewport.scrollWidth > viewport.clientWidth,
        records: Boolean(table?.classList.contains("records-on-phone")),
        label: firstCell
          ? getComputedStyle(firstCell, "::before").content
          : "none",
        pageOverflow: document.documentElement.scrollWidth > window.innerWidth,
      };
    });
    expect(mobileGeometry.localScroll).toBe(false);
    expect(mobileGeometry.records).toBe(true);
    expect(mobileGeometry.label).not.toBe("none");
    expect(mobileGeometry.pageOverflow).toBe(false);
  } finally {
    localSql(`
      begin;
      select set_config('app.basic_medical_registration_mutation', 'true', true);
      delete from public.basic_medical_registration_sessions where id = '${ids.session}';
      delete from public.class_schedules where id = '${ids.schedule}';
      delete from public.basic_medical_registrations where id = '${ids.registration}';
      delete from public.rooms where id = '${ids.room}';
      delete from public.courses where id = '${ids.course}';
      commit;
    `);
  }
});

test("canonical UI V2 shared geometry is applied in computed styles", async ({
  page,
}) => {
  const catalogFixtureId = crypto.randomUUID();
  const { error: catalogFixtureError } = await serviceDb
    .from("equipment_catalog")
    .insert({
      id: catalogFixtureId,
      item_name: "UI V2 computed fixture",
      commercial_name: `UI V2 computed ${catalogFixtureId}`,
      unit: "Cái",
      is_active: true,
    });
  if (catalogFixtureError) throw catalogFixtureError;
  try {
    await loginAsAdmin(page);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/dashboard", { waitUntil: "networkidle" });

    const topbar = page.locator(".workspace-topbar");
    await expect(topbar).toHaveCSS("position", "sticky");
    await expect(topbar).toHaveCSS("min-height", "82px");
    await expect(topbar).toHaveCSS("padding", "16px 30px");
    await expect(topbar).toHaveCSS("backdrop-filter", "blur(14px)");
    await expect(page.locator(".workspace-sidebar")).toHaveCSS(
      "width",
      "244px",
    );
    await expect(
      page.locator(".workspace-sidebar .nav-heading").first(),
    ).toHaveCSS("font-size", "14px");
    await expect(
      page.locator(".workspace-sidebar .nav-item").first(),
    ).toHaveCSS("font-size", "12px");

    await page.goto("/admin/equipment", { waitUntil: "networkidle" });
    const table = page.locator(".equipment-catalog-table");
    await expect(table.locator("th").first()).toHaveCSS("text-align", "left");
    await expect(table.locator("th").first()).toHaveCSS("padding", "14px 16px");
    await expect(table.locator("td").first()).toHaveCSS("padding", "14px 16px");
    await expect(
      table.locator("col.equipment-catalog-col-name").first(),
    ).toHaveCSS("width", "275px");
    await expect(
      table.locator("col.equipment-catalog-col-commercial-name"),
    ).toHaveCSS("width", "275px");
    await expect(
      table.locator("col.equipment-catalog-col-metadata").first(),
    ).toHaveCSS("width", "145px");

    const filter = page.locator(".equipment-catalog-filters select").first();
    await expect(filter).toHaveCSS("height", "44px");
    await filter.focus();
    await expect
      .poll(() =>
        filter.evaluate((element) => {
          const style = getComputedStyle(element);
          return {
            boxShadow: style.boxShadow,
            outlineStyle: style.outlineStyle,
            outlineWidth: style.outlineWidth,
          };
        }),
      )
      .toEqual({
        boxShadow: "rgba(20, 64, 105, 0.12) 0px 0px 0px 3px",
        outlineStyle: "none",
        outlineWidth: "0px",
      });
  } finally {
    await serviceDb
      .from("equipment_catalog")
      .delete()
      .eq("id", catalogFixtureId);
  }
});

test("table shells, counters, and catalog action slots retain Master geometry", async ({
  page,
}) => {
  const dashboardFixtureId = await createDashboardScheduleFixture();
  const equipmentFixtureId = crypto.randomUUID();
  const titleFixtureEmail = `ui-v2-title-${crypto.randomUUID()}@campus.local`;
  const titleFixtureName = "UI V2 Title Fixture";
  const titleFixtureTitle = "Điều phối viên";
  let titleFixtureId: string | null = null;
  const { error: equipmentFixtureError } = await serviceDb
    .from("equipment_catalog")
    .insert({
      id: equipmentFixtureId,
      item_name: "UI V2 right-edge fixture",
      commercial_name: `UI V2 right-edge ${equipmentFixtureId}`,
      unit: "Cái",
      is_active: true,
    });
  if (equipmentFixtureError) throw equipmentFixtureError;
  try {
    const { data: titleFixture, error: titleFixtureError } =
      await serviceDb.auth.admin.createUser({
        email: titleFixtureEmail,
        password: "LocalTitleFixture123!",
        email_confirm: true,
      });
    if (titleFixtureError || !titleFixture.user) {
      throw (
        titleFixtureError ?? new Error("Personnel title fixture is missing")
      );
    }
    titleFixtureId = titleFixture.user.id;
    const [{ error: titleProfileError }, { error: titleRoleError }] =
      await Promise.all([
        serviceDb
          .from("profiles")
          .update({
            full_name: titleFixtureName,
            title: titleFixtureTitle,
            is_active: true,
          })
          .eq("id", titleFixtureId),
        serviceDb
          .from("user_roles")
          .insert({ user_id: titleFixtureId, role: "staff" }),
      ]);
    if (titleProfileError || titleRoleError) {
      throw titleProfileError ?? titleRoleError;
    }

    await loginAsAdmin(page);
    await page.setViewportSize({ width: 1440, height: 1000 });

    await page.goto("/dashboard", { waitUntil: "networkidle" });
    await expect(
      page.locator(".workspace-sidebar .brand-lockup strong"),
    ).toHaveCSS("font-size", "21.5px");
    await expect(
      page.locator(".workspace-sidebar .brand-lockup strong"),
    ).toHaveCSS("font-weight", "800");
    await expect(
      page.locator(".workspace-sidebar .brand-lockup strong"),
    ).toHaveCSS("line-height", "25.8px");
    await expect(
      page.locator(".workspace-sidebar .brand-lockup strong"),
    ).toHaveCSS("letter-spacing", "-0.5375px");
    await expect(
      page.locator(".workspace-sidebar .brand-lockup strong"),
    ).toHaveCSS("color", "rgb(255, 255, 255)");
    await expect(page.locator(".workspace-sidebar .brand-mark")).toHaveCSS(
      "height",
      "62px",
    );
    await expect(page.locator(".workspace-sidebar .brand-mark")).toHaveCSS(
      "padding",
      "8px 10px",
    );
    await expect(page.locator(".workspace-sidebar .brand-mark")).toHaveCSS(
      "border-radius",
      "12px",
    );
    await page.setViewportSize({ width: 1366, height: 720 });
    const [brand, firstHeading] = await page
      .locator(
        ".workspace-sidebar .brand-copy, .workspace-sidebar .nav-heading",
      )
      .evaluateAll((elements) =>
        elements.slice(0, 2).map((element) => {
          const rect = element.getBoundingClientRect();
          return { top: rect.top, bottom: rect.bottom };
        }),
      );
    expect(firstHeading.top - brand.bottom).toBeGreaterThanOrEqual(0);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await assertTableRightEdge(page, {
      shell: ".overview-schedule-panel",
      viewport: ".overview-schedule-panel .responsive-table",
      table: ".overview-schedule-table",
    });
    await expect(page.locator(".overview-schedule-table th").first()).toHaveCSS(
      "text-align",
      "left",
    );

    await page.goto("/admin/equipment", { waitUntil: "networkidle" });
    const catalogCount = page.locator(
      ".equipment-catalog-filters .equipment-catalog-count",
    );
    await expect(catalogCount).toHaveCSS("height", "44px");
    await expect(catalogCount).toHaveCSS("display", "inline-flex");
    await expect(catalogCount).toHaveCSS("align-items", "center");
    await expect(catalogCount).toHaveCSS("justify-content", "center");
    await expect(page.locator(".equipment-catalog-table-wrap")).toHaveCSS(
      "scrollbar-gutter",
      "auto",
    );
    await expect(page.locator(".equipment-catalog-table-wrap")).toHaveCSS(
      "padding-right",
      "0px",
    );
    await assertTableRightEdge(page, {
      shell: ".equipment-catalog-panel",
      viewport: ".equipment-catalog-table-wrap",
      table: ".equipment-catalog-table",
    });

    await page.goto("/equipment/requests", { waitUntil: "networkidle" });
    const requestCount = page.locator(".equipment-filter-count").first();
    await expect(requestCount).toHaveCSS("height", "44px");
    await expect(requestCount).toHaveCSS("display", "inline-flex");
    await expect(requestCount).toHaveCSS("align-items", "center");
    await expect(requestCount).toHaveCSS("justify-content", "center");
    await expect(page.locator(".equipment-request-table th").first()).toHaveCSS(
      "text-align",
      "left",
    );

    await page.goto("/admin/personnel", { waitUntil: "networkidle" });
    const personnelCount = page.locator(".personnel-result-count");
    await expect(personnelCount).toHaveCSS("height", "44px");
    await expect(personnelCount).toHaveCSS("display", "inline-flex");
    await expect(personnelCount).toHaveCSS("align-items", "center");
    await expect(personnelCount).toHaveCSS("justify-content", "center");
    const personnelTable = page.locator(".personnel-table-wrap");
    await expect(personnelTable).toHaveCSS("scrollbar-gutter", "auto");
    await expect(personnelTable.locator("th").first()).toHaveCSS(
      "text-align",
      "left",
    );
    const personnelRow = personnelTable
      .locator("tbody tr")
      .filter({ hasText: "L\u00ea Ho\u00e0ng Minh" })
      .first();
    await expect(personnelRow).toBeVisible();
    const personnelCells = personnelRow.locator("td");
    await expect(personnelCells.nth(0)).toHaveText("LHM");
    await expect(personnelCells.nth(1)).toContainText(
      "L\u00ea Ho\u00e0ng Minh",
    );
    await expect(personnelCells.nth(1)).not.toContainText("LHM");
    await expect(personnelTable).toHaveCSS("padding-right", "0px");
    await assertTableRightEdge(page, {
      shell: ".personnel-table-wrap",
      viewport: ".personnel-table-wrap",
      table: ".personnel-table",
      ownsVisualShell: true,
    });

    await page.goto(
      `/admin/personnel?q=${encodeURIComponent(titleFixtureEmail)}`,
      { waitUntil: "networkidle" },
    );
    const titleRow = page
      .locator(".personnel-table tbody tr")
      .filter({ hasText: titleFixtureEmail });
    await expect(titleRow).toBeVisible();
    const titleCells = titleRow.locator("td");
    await expect(titleCells.nth(1)).toContainText(titleFixtureName);
    await expect(titleCells.nth(1)).toContainText(titleFixtureTitle);

    const assertStableCatalogActions = async (route: string) => {
      await page.goto(route, { waitUntil: "networkidle" });
      const group = page.locator(".catalog-master-action-group");
      const buttons = group.locator("button");
      await expect(buttons).toHaveCount(4);
      await expect(buttons).toHaveText([
        "Kích hoạt",
        "Sửa",
        "Ngừng sử dụng",
        "Xóa",
      ]);
      const before = await buttons.evaluateAll((elements) =>
        elements.map((element) => {
          const box = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return {
            x: box.x,
            width: box.width,
            minHeight: style.minHeight,
            whiteSpace: style.whiteSpace,
          };
        }),
      );
      expect(before.map((item) => item.width)).toEqual([154, 154, 154, 154]);
      expect(before.map((item) => item.minHeight)).toEqual([
        "42px",
        "42px",
        "42px",
        "42px",
      ]);
      expect(before.map((item) => item.whiteSpace)).toEqual([
        "nowrap",
        "nowrap",
        "nowrap",
        "nowrap",
      ]);
      await page
        .locator('.catalog-data-table tbody input[type="checkbox"]')
        .first()
        .check();
      await group.locator("button").nth(1).click();
      await expect(
        page.locator(".catalog-data-table tr.is-editing"),
      ).toHaveCount(1);
      const after = await buttons.evaluateAll((elements) =>
        elements.map((element) => element.getBoundingClientRect().x),
      );
      expect(after).toEqual(before.map((item) => item.x));
      await page.getByRole("button", { name: "Hủy", exact: true }).click();
    };

    await assertStableCatalogActions("/admin/rooms");
    await assertStableCatalogActions("/admin/courses");
    await page.goto("/admin/rooms", { waitUntil: "networkidle" });
    await assertTableRightEdge(page, {
      shell: ".catalog-data-panel",
      viewport: ".catalog-data-panel .responsive-table",
      table: ".kho-list .catalog-data-table",
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/admin/rooms", { waitUntil: "networkidle" });
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true);
    const mobileCatalogActions = page.locator(
      ".catalog-master-action-group button",
    );
    await expect(mobileCatalogActions).toHaveCount(4);
    for (const action of await mobileCatalogActions.all()) {
      await expect(action).toBeVisible();
    }
  } finally {
    await serviceDb
      .from("equipment_catalog")
      .delete()
      .eq("id", equipmentFixtureId);
    await serviceDb
      .from("class_schedules")
      .delete()
      .eq("id", dashboardFixtureId);
    if (titleFixtureId) {
      await serviceDb.auth.admin.deleteUser(titleFixtureId);
    }
  }
});
