"use client";
import { importsEnabled } from "@/lib/feature-flags";

import {
  CalendarDays,
  CalendarDaysSolid,
  ChevronRight,
  ClipboardList,
  ClipboardListSolid,
  DoorOpen,
  DoorOpenSolid,
  FileClock,
  FileClockSolid,
  GraduationCap,
  GraduationCapSolid,
  Import,
  ImportSolid,
  LayoutDashboard,
  LayoutDashboardSolid,
  LogOut,
  Menu,
  PackageCheck,
  PackageCheckSolid,
  PanelLeftClose,
  Plus,
  PlusSolid,
  Settings,
  SettingsSolid,
  Users,
  UsersSolid,
  type AppIcon,
} from "@/components/icons";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AppRole } from "@/lib/viewer";
import { logout } from "@/app/login/actions";
import { getNameInitials } from "@/lib/person-name";
import { PageHeader } from "@/components/patterns/page-header";
import { NotificationBell } from "@/components/notification-bell";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import {
  canCreateBasicMedicalSchedules,
  canImportBasicMedicalSchedules,
  canImportSkillsSchedules,
  canManageBasicMedicalWorkspace,
  canUseEquipmentOperations,
  canUseBasicMedicalEquipmentRegistration,
  canUseSkillsWorkspace,
  canViewBasicMedicalRegistrations,
  canViewBasicMedicalSchedules,
} from "@/lib/workspace-access";
import { useLanguage } from "@/components/i18n/language-provider";
import { createClient } from "@/lib/supabase/client";

const roleLabels: Record<AppRole, string> = {
  admin: "Quản trị viên",
  lecturer: "Giảng viên",
  staff: "Chuyên viên",
  teaching_assistant: "Trợ giảng",
  viewer: "Người xem",
};

const primaryRoleOrder: AppRole[] = [
  "admin",
  "staff",
  "teaching_assistant",
  "lecturer",
  "viewer",
];
const sidebarScrollStorageKey = "medlabs-sidebar-scroll:v1";
const sidebarGroupsStorageKey = "medlabs-sidebar-groups:v1";
const guideUrl = process.env.NEXT_PUBLIC_GUIDE_URL;
const operationsHref = "/equipment/operations";

function getPrimaryRoleLabel(roles: AppRole[]) {
  const primaryRole = primaryRoleOrder.find((role) => roles.includes(role));
  return primaryRole ? roleLabels[primaryRole] : "Người dùng";
}

function NavCount({ count }: { count: number }) {
  const { text: uiText } = useLanguage();
  return (
    <span
      className="nav-count"
      aria-label={uiText("{0} phiếu đang mở", [count])}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

type NavItem = {
  label: string;
  href: string;
  icon: AppIcon;
  activeIcon: AppIcon;
  roles?: AppRole[];
  activeHrefs?: string[];
};

function buildNavigation(
  roles: AppRole[],
  roomTypeCodes: string[],
  allowBasicMedicalAccess: boolean,
  canImportSchedules: boolean,
  canManagePersonnel: boolean,
  canManageEmailNotifications: boolean,
): Array<{ label: string; items: NavItem[] }> {
  const isAdmin = roles.includes("admin");
  const isStaff = roles.includes("staff") && !isAdmin;
  const hasSkillsScope = roomTypeCodes.includes("nursing_skills");
  const hasSkillsWorkspace = canUseSkillsWorkspace(roles, roomTypeCodes);
  const canUseBasicMedicalEquipment = canUseBasicMedicalEquipmentRegistration(
    roles,
    roomTypeCodes,
  );
  const canUseEquipmentManagement = canUseEquipmentOperations(
    roles,
    roomTypeCodes,
  );
  const canManageSkillsEquipment = isAdmin || (isStaff && hasSkillsScope);
  const canImport = canImportSkillsSchedules(
    roles,
    roomTypeCodes,
    canImportSchedules,
  );
  const canCreateSkills =
    isAdmin ||
    isStaff ||
    (hasSkillsScope &&
      roles.some((role) => ["lecturer", "teaching_assistant"].includes(role)));
  const isViewer = roles.includes("viewer");
  const canUseSkillsEquipment = hasSkillsWorkspace && !isViewer;
  const canShowBasicMedical = canViewBasicMedicalSchedules(
    roles,
    roomTypeCodes,
  );
  const groups: Array<{ label: string; items: NavItem[] }> = [];
  const pushGroup = (label: string, items: NavItem[]) => {
    if (items.length > 0) groups.push({ label, items });
  };
  const canBasicMedicalCatalog =
    (isAdmin || isStaff) &&
    canManageBasicMedicalWorkspace(roles, roomTypeCodes);

  // Group 1 — Lịch
  const lichItems: NavItem[] = [];
  if (hasSkillsWorkspace) {
    lichItems.push(
      {
        label: "Tổng quan Skills lab",
        href: "/dashboard",
        icon: LayoutDashboard,
        activeIcon: LayoutDashboardSolid,
      },
      {
        label: "Lịch Skills lab",
        href: "/class-schedules",
        icon: CalendarDays,
        activeIcon: CalendarDaysSolid,
      },
    );
  }
  if (canShowBasicMedical) {
    lichItems.push({
      label: "Lịch Y cơ sở",
      href: "/basic-medical/schedules",
      icon: CalendarDays,
      activeIcon: CalendarDaysSolid,
    });
  }
  if (canUseEquipmentManagement && canManageSkillsEquipment) {
    lichItems.push({
      label: "Lịch trực",
      href: "/staff-shifts",
      icon: PackageCheck,
      activeIcon: PackageCheckSolid,
    });
  }
  pushGroup("Lịch", lichItems);

  // Group 2 — Lớp & đăng ký
  const lopItems: NavItem[] = [];
  if (canCreateSkills) {
    lopItems.push({
      label: "Tạo lịch Skills lab",
      href: "/schedule-entry/new",
      icon: Plus,
      activeIcon: PlusSolid,
    });
  }
  if (
    canShowBasicMedical &&
    canCreateBasicMedicalSchedules(
      roles,
      roomTypeCodes,
      allowBasicMedicalAccess,
    )
  ) {
    lopItems.push({
      label: "Tạo lịch Y cơ sở",
      href: "/basic-medical/new",
      icon: Plus,
      activeIcon: PlusSolid,
    });
  }
  if (canUseSkillsEquipment) {
    lopItems.push({
      label: "Đăng ký thiết bị",
      href: "/equipment/register",
      icon: ClipboardList,
      activeIcon: ClipboardListSolid,
    });
  }
  // One shared registration screen (t4e); dual-scope users switch there.
  if (
    canShowBasicMedical &&
    canUseBasicMedicalEquipment &&
    !canUseSkillsEquipment
  ) {
    lopItems.push({
      label: "Đăng ký thiết bị",
      href: "/equipment/register?scope=basic_medical",
      icon: ClipboardList,
      activeIcon: ClipboardListSolid,
      activeHrefs: ["/equipment/register", "/basic-medical/equipment-requests"],
    });
  }
  if (importsEnabled() && canCreateSkills && canImport) {
    lopItems.push({
      label: "Import lịch Skills lab",
      href: "/schedule-entry/import",
      icon: Import,
      activeIcon: ImportSolid,
    });
  }
  if (
    importsEnabled() &&
    canCreateSkills &&
    (isAdmin || isStaff || canImport)
  ) {
    lopItems.push({
      label: "Import dữ liệu",
      href: "/imports",
      icon: FileClock,
      activeIcon: FileClockSolid,
    });
  }
  if (
    canShowBasicMedical &&
    importsEnabled() &&
    canImportBasicMedicalSchedules(roles, roomTypeCodes, canImportSchedules)
  ) {
    lopItems.push({
      label: "Import lịch Y cơ sở",
      href: "/basic-medical/import",
      icon: Import,
      activeIcon: ImportSolid,
    });
  }
  if (
    hasSkillsScope &&
    roles.some((role) =>
      ["admin", "staff", "lecturer", "teaching_assistant"].includes(role),
    )
  ) {
    lopItems.push({
      label: "Lớp đang mở",
      href: "/classes/open",
      icon: GraduationCap,
      activeIcon: GraduationCapSolid,
    });
  }
  if (hasSkillsScope && roles.includes("lecturer")) {
    lopItems.push({
      label: "Lớp của tôi",
      href: "/classes/mine",
      icon: ClipboardList,
      activeIcon: ClipboardListSolid,
    });
  }
  if (hasSkillsScope && !isViewer) {
    lopItems.push({
      label: "Phiếu thiết bị của tôi",
      href: "/equipment/mine",
      icon: FileClock,
      activeIcon: FileClockSolid,
    });
  }
  pushGroup("Lớp & đăng ký", lopItems);

  // Group 3 — Theo dõi phiếu
  const theoDoiItems: NavItem[] = [];
  if (canUseEquipmentManagement) {
    theoDoiItems.push({
      label: "Phiếu thiết bị",
      href: "/equipment/requests",
      icon: FileClock,
      activeIcon: FileClockSolid,
    });
  }
  // "Import Phiếu thiết bị" is hidden (owner decision, 2026-11-17): the
  // inventory line guard rejects finished requests, so the import cannot
  // succeed. Its page redirects until the feature is reopened.
  if (canShowBasicMedical) {
    if (canViewBasicMedicalRegistrations(roles, roomTypeCodes)) {
      theoDoiItems.push({
        label: "Phiếu Y cơ sở",
        href: "/basic-medical/registrations",
        icon: ClipboardList,
        activeIcon: ClipboardListSolid,
      });
    }
    if (!canManageBasicMedicalWorkspace(roles, roomTypeCodes)) {
      theoDoiItems.push({
        label: "Thiết bị Y cơ sở",
        href: "/basic-medical/equipment?tab=rooms",
        icon: ClipboardList,
        activeIcon: ClipboardListSolid,
      });
    }
  }
  pushGroup("Theo dõi phiếu", theoDoiItems);

  // Group 4 + 5 — Kho: daily work, then setup (approved menu tree).
  if (isAdmin || isStaff) {
    pushGroup("Vận hành kho", [
      {
        label: "Công việc & giao nhận",
        href: "/equipment/operations",
        icon: PackageCheck,
        activeIcon: PackageCheckSolid,
      },
      {
        label: "Tồn kho",
        href: "/inventory/stock",
        icon: PackageCheck,
        activeIcon: PackageCheckSolid,
        // Exact match only, so /inventory/receive etc. do not light this up.
        activeHrefs: ["/inventory/stock", "/inventory"],
      },
      {
        label: "Kho theo phòng",
        href: "/inventory/rooms",
        icon: DoorOpen,
        activeIcon: DoorOpenSolid,
      },
      {
        label: "Nhận kho",
        href: "/inventory/receive",
        icon: Plus,
        activeIcon: PlusSolid,
      },
      {
        label: "Nghiệp vụ kho",
        href: "/inventory/operations",
        icon: ClipboardList,
        activeIcon: ClipboardListSolid,
      },
      {
        label: "Lịch sử giao dịch",
        href: "/inventory/transactions",
        icon: FileClock,
        activeIcon: FileClockSolid,
      },
    ]);

    // One Danh mục entry (t4c); CatalogTabs on each catalog page shows the
    // tabs this viewer may open.
    const thietLapItems: NavItem[] = [
      {
        label: "Danh mục",
        href: isAdmin
          ? "/admin/equipment"
          : canBasicMedicalCatalog
            ? "/basic-medical/equipment"
            : "/inventory/catalog",
        icon: Settings,
        activeIcon: SettingsSolid,
        activeHrefs: [
          "/admin/equipment",
          "/admin/courses",
          "/admin/rooms",
          "/admin/equipment-scopes",
          "/admin/audit",
          "/basic-medical/equipment",
          "/inventory/catalog",
        ],
      },
      {
        label: "Thiết bị cá thể",
        href: "/inventory/assets",
        icon: ClipboardList,
        activeIcon: ClipboardListSolid,
      },
      {
        label: "Hồ sơ nguồn",
        href: "/inventory/acquisitions",
        icon: ClipboardList,
        activeIcon: ClipboardListSolid,
      },
      {
        label: "Nhà cung cấp",
        href: "/inventory/suppliers",
        icon: Users,
        activeIcon: UsersSolid,
      },
      {
        label: "Vị trí kho",
        href: "/inventory/locations",
        icon: Settings,
        activeIcon: SettingsSolid,
      },
    ];
    if (isAdmin) {
      thietLapItems.push(
        {
          label: "Tồn đầu kỳ",
          href: "/inventory/opening",
          icon: Import,
          activeIcon: ImportSolid,
        },
        {
          label: "Ghép danh mục Y cơ sở",
          href: "/inventory/basic-medical-mapping",
          icon: ClipboardList,
          activeIcon: ClipboardListSolid,
        },
      );
    }
    pushGroup("Thiết lập", thietLapItems);
  }

  // Group 6 — Quản trị
  const adminItems: NavItem[] = [];
  if (isAdmin && canManagePersonnel) {
    adminItems.push({
      label: "Nhân sự",
      href: "/admin/personnel",
      icon: Users,
      activeIcon: UsersSolid,
    });
  }
  if (
    canUseEquipmentManagement &&
    canManageSkillsEquipment &&
    canManageEmailNotifications
  ) {
    adminItems.push({
      label: "Email thông báo",
      href: "/email-notifications",
      icon: FileClock,
      activeIcon: FileClockSolid,
    });
  }
  pushGroup("Quản trị", adminItems);

  return groups;
}

export function WorkspaceShell({
  fullName,
  roles,
  title,
  description,
  actions,
  children,
  roomTypeCodes = [],
  allowBasicMedicalAccess = false,
  canImportSchedules = false,
  canManagePersonnel = false,
  canManageEmailNotifications = false,
}: {
  fullName: string;
  roles: AppRole[];
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  roomTypeCodes?: string[];
  allowBasicMedicalAccess?: boolean;
  canImportSchedules?: boolean;
  canManagePersonnel?: boolean;
  canManageEmailNotifications?: boolean;
}) {
  const { text: uiText } = useLanguage();

  const pathname = usePathname();
  const [currentPathname, setCurrentPathname] = useState(pathname);
  const [sidebarOpenState, setSidebarOpen] = useState(false);
  const [accountMenuOpenState, setAccountMenuOpen] = useState(false);
  if (pathname !== currentPathname) {
    setCurrentPathname(pathname);
    setSidebarOpen(false);
    setAccountMenuOpen(false);
  }
  const sidebarOpen = pathname === currentPathname ? sidebarOpenState : false;
  const accountMenuOpen =
    pathname === currentPathname ? accountMenuOpenState : false;
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const accountTriggerRef = useRef<HTMLButtonElement>(null);
  const logoutButtonRef = useRef<HTMLButtonElement>(null);
  const navigationRef = useRef<HTMLElement>(null);
  const navigation = buildNavigation(
    roles,
    roomTypeCodes,
    allowBasicMedicalAccess,
    canImportSchedules,
    canManagePersonnel,
    canManageEmailNotifications,
  );
  const hasOperations = navigation.some((group) =>
    group.items.some((item) => item.href === operationsHref),
  );
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>([]);
  const [operationsCount, setOperationsCount] = useState(0);
  const primaryRoleLabel = getPrimaryRoleLabel(roles);
  const initials = getNameInitials(fullName);

  useLayoutEffect(() => {
    try {
      const stored = Number(
        sessionStorage.getItem(sidebarScrollStorageKey) ?? "0",
      );
      if (navigationRef.current && Number.isFinite(stored)) {
        navigationRef.current.scrollTop = stored;
      }
    } catch {
      // Storage can be disabled in private browsing; navigation still works normally.
    }
  }, [pathname]);

  useEffect(() => {
    try {
      const stored = JSON.parse(
        localStorage.getItem(sidebarGroupsStorageKey) ?? "[]",
      );
      if (Array.isArray(stored)) {
        // Read after mount so server and client markup match.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setCollapsedGroups(stored.filter((x) => typeof x === "string"));
      }
    } catch {
      // Storage unavailable or corrupt: every group stays open.
    }
  }, []);

  useEffect(() => {
    if (!hasOperations) return;
    let cancelled = false;
    createClient()
      .rpc("equipment_operations_read", {
        p_filters: { phase: "all", search: "", page: 1 },
      })
      .then(({ data, error }) => {
        const total = (data as { total?: unknown } | null)?.total;
        if (cancelled) return;
        setOperationsCount(!error && typeof total === "number" ? total : 0);
      });
    return () => {
      cancelled = true;
    };
  }, [hasOperations, pathname]);

  function toggleGroup(label: string) {
    const next = collapsedGroups.includes(label)
      ? collapsedGroups.filter((x) => x !== label)
      : [...collapsedGroups, label];
    setCollapsedGroups(next);
    try {
      localStorage.setItem(sidebarGroupsStorageKey, JSON.stringify(next));
    } catch {
      // Ignore unavailable storage.
    }
  }

  function rememberSidebarScroll() {
    try {
      sessionStorage.setItem(
        sidebarScrollStorageKey,
        String(navigationRef.current?.scrollTop ?? 0),
      );
    } catch {
      // Ignore unavailable session storage.
    }
  }

  useEffect(() => {
    if (!sidebarOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setSidebarOpen(false);
      requestAnimationFrame(() => menuButtonRef.current?.focus());
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [sidebarOpen]);

  useEffect(() => {
    if (!accountMenuOpen) return;

    requestAnimationFrame(() => logoutButtonRef.current?.focus());

    function closeAccountMenu(event: PointerEvent) {
      if (accountMenuRef.current?.contains(event.target as Node)) return;
      setAccountMenuOpen(false);
    }

    function handleAccountMenuKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setAccountMenuOpen(false);
      requestAnimationFrame(() => accountTriggerRef.current?.focus());
    }

    document.addEventListener("pointerdown", closeAccountMenu);
    window.addEventListener("keydown", handleAccountMenuKeyDown);
    return () => {
      document.removeEventListener("pointerdown", closeAccountMenu);
      window.removeEventListener("keydown", handleAccountMenuKeyDown);
    };
  }, [accountMenuOpen]);

  return (
    <div className="app-shell">
      <aside
        aria-label={uiText("Menu chính")}
        aria-modal={sidebarOpen ? "true" : undefined}
        className={`sidebar workspace-sidebar ${sidebarOpen ? "sidebar-open" : ""}`}
        id="workspace-navigation"
        role={sidebarOpen ? "dialog" : undefined}
      >
        <div className="brand-lockup">
          <div className="brand-mark">
            <Image
              src="/eiu-full-logo.jpg"
              alt="Logo Eastern International University"
              width={2982}
              height={846}
              priority
            />
          </div>
          <div className="brand-copy">
            <strong>{uiText("MedLabs Calendar")}</strong>
          </div>
          <button
            className="icon-button sidebar-close"
            onClick={() => setSidebarOpen(false)}
            aria-label={uiText("Đóng menu")}
            ref={closeButtonRef}
          >
            <PanelLeftClose size={19} />
          </button>
        </div>

        <nav
          aria-label={uiText("Điều hướng chính")}
          className="workspace-nav"
          ref={navigationRef}
          onScroll={rememberSidebarScroll}
        >
          {navigation.map((group) => {
            const items = group.items.filter(
              (item) =>
                !item.roles ||
                item.roles.some((requiredRole) => roles.includes(requiredRole)),
            );
            if (!items.length) return null;
            const isActive = (item: NavItem) =>
              pathname === item.href ||
              (item.href !== "/dashboard" &&
                pathname.startsWith(`${item.href}/`)) ||
              Boolean(
                item.activeHrefs?.some((activeHref) => pathname === activeHref),
              );
            const expanded =
              !collapsedGroups.includes(group.label) || items.some(isActive);
            const groupCount = items.some(
              (item) => item.href === operationsHref,
            )
              ? operationsCount
              : 0;
            const listId = `nav-group-${group.label.replace(/\W+/g, "-")}`;
            return (
              <div className="nav-group" key={group.label}>
                <button
                  aria-controls={listId}
                  aria-expanded={expanded}
                  className="nav-heading nav-group-toggle"
                  onClick={() => toggleGroup(group.label)}
                  type="button"
                >
                  <span>{uiText(group.label)}</span>
                  {!expanded && groupCount > 0 ? (
                    <NavCount count={groupCount} />
                  ) : null}
                  <ChevronRight
                    aria-hidden="true"
                    className="nav-group-chevron"
                    size={14}
                  />
                </button>
                <div hidden={!expanded} id={listId}>
                  {items.map((item) => {
                    const {
                      label,
                      href,
                      icon: OutlineIcon,
                      activeIcon: SolidIcon,
                    } = item;
                    const active = isActive(item);
                    return (
                      <Link
                        className={`nav-item ${active ? "active" : ""}`}
                        href={href}
                        key={href}
                        onClick={() => {
                          rememberSidebarScroll();
                          setAccountMenuOpen(false);
                          setSidebarOpen(false);
                        }}
                      >
                        {active ? (
                          <SolidIcon size={19} />
                        ) : (
                          <OutlineIcon size={19} />
                        )}
                        <span>{uiText(label)}</span>
                        {href === operationsHref && operationsCount > 0 ? (
                          <NavCount count={operationsCount} />
                        ) : null}
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {guideUrl ? (
            <a
              className="nav-item"
              href={guideUrl}
              rel="noreferrer"
              target="_blank"
            >
              <span>{uiText("Hướng dẫn sử dụng")}</span>
            </a>
          ) : null}
        </nav>

        <div className="workspace-account-menu" ref={accountMenuRef}>
          {accountMenuOpen ? (
            <div
              className="workspace-account-popover"
              id="workspace-account-actions"
            >
              <form action={logout}>
                <button
                  className="workspace-account-action"
                  type="submit"
                  ref={logoutButtonRef}
                >
                  <LogOut aria-hidden="true" size={19} />
                  <span>{uiText("Đăng xuất")}</span>
                </button>
              </form>
            </div>
          ) : null}
          <button
            aria-controls="workspace-account-actions"
            aria-expanded={accountMenuOpen}
            aria-label={uiText("Tài khoản của {0}", [fullName])}
            className="user-card workspace-user workspace-user-trigger"
            onClick={() => setAccountMenuOpen((open) => !open)}
            ref={accountTriggerRef}
            type="button"
          >
            <span className="avatar initials-avatar" aria-hidden="true">
              {initials}
            </span>
            <span className="workspace-user-copy">
              <strong>{fullName}</strong>
              <span>{uiText(primaryRoleLabel)}</span>
            </span>
            <ChevronRight
              aria-hidden="true"
              className="workspace-user-chevron"
              size={18}
            />
          </button>
        </div>
      </aside>

      {sidebarOpen ? (
        <button
          className="sidebar-scrim"
          onClick={() => setSidebarOpen(false)}
          aria-label={uiText("Đóng menu")}
        />
      ) : null}

      <main className="workspace-main">
        <PageHeader
          menu={
            <button
              aria-controls="workspace-navigation"
              aria-expanded={sidebarOpen}
              className="icon-button menu-button"
              onClick={() => setSidebarOpen(true)}
              aria-label={uiText("Mở menu")}
              ref={menuButtonRef}
            >
              <Menu size={21} />
            </button>
          }
          title={title}
          description={description}
          actions={
            <>
              <LanguageSwitcher />
              <NotificationBell />
              {actions}
            </>
          }
        />
        <div className="workspace-content page-container">{children}</div>
      </main>
    </div>
  );
}
