"use client";

import {
  CalendarDays,
  CalendarDaysSolid,
  ChevronRight,
  ClipboardList,
  ClipboardListSolid,
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
import {
  canCreateBasicMedicalSchedules,
  canImportBasicMedicalSchedules,
  canManageBasicMedicalWorkspace,
  canUseEquipmentOperations,
  canUseBasicMedicalEquipmentRegistration,
  canUseSkillsWorkspace,
  canViewBasicMedicalRegistrations,
  canViewBasicMedicalSchedules,
} from "@/lib/workspace-access";

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

function getPrimaryRoleLabel(roles: AppRole[]) {
  const primaryRole = primaryRoleOrder.find((role) => roles.includes(role));
  return primaryRole ? roleLabels[primaryRole] : "Người dùng";
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
  const canImport =
    isAdmin ||
    (canImportSchedules &&
      hasSkillsScope &&
      roles.some((role) =>
        ["staff", "lecturer", "teaching_assistant"].includes(role),
      ));
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

  // Group 1 — Kỹ năng Điều dưỡng
  if (hasSkillsWorkspace) {
    groups.push({
      label: "Kỹ năng Điều dưỡng",
      items: [
        {
          label: "Tổng quan",
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
      ],
    });
  }

  // Group 2 — Tạo phiếu
  const taoPhieuItems: NavItem[] = [];
  if (canCreateSkills) {
    taoPhieuItems.push({
      label: "Tạo lịch Skills lab",
      href: "/schedule-entry/new",
      icon: Plus,
      activeIcon: PlusSolid,
    });
  }
  if (canUseSkillsEquipment) {
    taoPhieuItems.push({
      label: "Đăng ký thiết bị",
      href: "/equipment/register",
      icon: ClipboardList,
      activeIcon: ClipboardListSolid,
    });
  }
  if (canCreateSkills && canImport) {
    taoPhieuItems.push({
      label: "Import lịch Skills lab",
      href: "/schedule-entry/import",
      icon: Import,
      activeIcon: ImportSolid,
    });
  }
  if (canCreateSkills && (isAdmin || isStaff || canImport)) {
    taoPhieuItems.push({
      label: "Lịch sử import",
      href: "/imports",
      icon: FileClock,
      activeIcon: FileClockSolid,
    });
  }
  if (taoPhieuItems.length > 0) {
    groups.push({
      label: "Tạo phiếu",
      items: taoPhieuItems,
    });
  }

  // Group 3 — Quản lý lớp
  const quanLyLopItems: NavItem[] = [];
  if (
    hasSkillsScope &&
    roles.some((role) =>
      ["admin", "staff", "lecturer", "teaching_assistant"].includes(role),
    )
  ) {
    quanLyLopItems.push({
      label: "Lớp đang mở",
      href: "/classes/open",
      icon: GraduationCap,
      activeIcon: GraduationCapSolid,
    });
  }
  if (hasSkillsScope && roles.includes("lecturer")) {
    quanLyLopItems.push({
      label: "Lớp của tôi",
      href: "/classes/mine",
      icon: ClipboardList,
      activeIcon: ClipboardListSolid,
    });
  }
  if (hasSkillsScope && !isViewer) {
    quanLyLopItems.push({
      label: "Phiếu thiết bị của tôi",
      href: "/equipment/mine",
      icon: FileClock,
      activeIcon: FileClockSolid,
    });
  }
  if (quanLyLopItems.length > 0) {
    groups.push({
      label: "Quản lý lớp",
      items: quanLyLopItems,
    });
  }

  // Group 4 — Quản lý phòng
  const quanLyPhongItems: NavItem[] = [];
  if (canUseEquipmentManagement) {
    if (canManageSkillsEquipment) {
      quanLyPhongItems.push({
        label: "Lịch trực",
        href: "/staff-shifts",
        icon: PackageCheck,
        activeIcon: PackageCheckSolid,
      });
    }
    quanLyPhongItems.push({
      label: "Phiếu thiết bị",
      href: "/equipment/requests",
      icon: FileClock,
      activeIcon: FileClockSolid,
    });
    if (canManageSkillsEquipment) {
      quanLyPhongItems.push({
        label: "Import Phiếu thiết bị",
        href: "/equipment/import",
        icon: Import,
        activeIcon: ImportSolid,
      });
    }
    if (canManageSkillsEquipment && canManageEmailNotifications) {
      quanLyPhongItems.push({
        label: "Email thông báo",
        href: "/email-notifications",
        icon: FileClock,
        activeIcon: FileClockSolid,
      });
    }
  }
  if (quanLyPhongItems.length > 0) {
    groups.push({
      label: "Quản lý phòng",
      items: quanLyPhongItems,
    });
  }

  // Group 5 — Y cơ sở
  if (canShowBasicMedical) {
    const yItems: NavItem[] = [
      {
        label: "Lịch Y cơ sở",
        href: "/basic-medical/schedules",
        icon: CalendarDays,
        activeIcon: CalendarDaysSolid,
      },
    ];
    if (
      canCreateBasicMedicalSchedules(
        roles,
        roomTypeCodes,
        allowBasicMedicalAccess,
      )
    ) {
      yItems.push({
        label: "Tạo lịch Y cơ sở",
        href: "/basic-medical/new",
        icon: Plus,
        activeIcon: PlusSolid,
      });
    }
    if (canViewBasicMedicalRegistrations(roles, roomTypeCodes)) {
      yItems.push({
        label: "Phiếu Y cơ sở",
        href: "/basic-medical/registrations",
        icon: ClipboardList,
        activeIcon: ClipboardListSolid,
      });
    }
    if (canUseBasicMedicalEquipment) {
      yItems.push({
        label: "Đăng ký thiết bị",
        href: "/basic-medical/equipment-requests",
        icon: ClipboardList,
        activeIcon: ClipboardListSolid,
      });
    }
    if (
      canImportBasicMedicalSchedules(roles, roomTypeCodes, canImportSchedules)
    ) {
      yItems.push({
        label: "Import lịch Y cơ sở",
        href: "/basic-medical/import",
        icon: Import,
        activeIcon: ImportSolid,
      });
    }
    if (
      canViewBasicMedicalSchedules(roles, roomTypeCodes) &&
      !canManageBasicMedicalWorkspace(roles, roomTypeCodes)
    ) {
      yItems.push({
        label: "Thiết bị Y cơ sở",
        href: "/basic-medical/equipment?tab=rooms",
        icon: ClipboardList,
        activeIcon: ClipboardListSolid,
      });
    }
    if (yItems.length > 0) {
      groups.push({ label: "Y cơ sở", items: yItems });
    }
  }

  // Group 6 — Quản trị
  const adminItems: NavItem[] = [];
  if (isAdmin) {
    if (canManagePersonnel) {
      adminItems.push({
        label: "Nhân sự",
        href: "/admin/personnel",
        icon: Users,
        activeIcon: UsersSolid,
      });
    }
    adminItems.push(
      {
        label: "Danh mục TB Skills lab",
        href: "/admin/equipment",
        icon: Settings,
        activeIcon: SettingsSolid,
      },
      {
        label: "Danh mục khác",
        href: "/admin/courses",
        icon: Settings,
        activeIcon: SettingsSolid,
        activeHrefs: [
          "/admin/catalogs",
          "/admin/courses",
          "/admin/rooms",
          "/admin/audit",
        ],
      },
    );
  }
  if (
    (isAdmin || isStaff) &&
    canManageBasicMedicalWorkspace(roles, roomTypeCodes)
  ) {
    adminItems.push({
      label: "Danh mục TB Y cơ sở",
      href: "/basic-medical/equipment",
      icon: ClipboardList,
      activeIcon: ClipboardListSolid,
    });
  }
  if (adminItems.length > 0) {
    groups.push({
      label: "Quản trị",
      items: adminItems,
    });
  }

  // Group 7 — Quản lý Kho & Thiết bị (S1 Inventory)
  if (isAdmin || isStaff) {
    const inventoryItems: NavItem[] = [
      {
        label: "Tổng quan",
        href: "/inventory",
        icon: LayoutDashboard,
        activeIcon: LayoutDashboardSolid,
      },
      {
        label: "Tồn kho",
        href: "/inventory/stock",
        icon: PackageCheck,
        activeIcon: PackageCheckSolid,
      },
      {
        label: "Thiết bị cá thể",
        href: "/inventory/assets",
        icon: ClipboardList,
        activeIcon: ClipboardListSolid,
      },
      {
        label: "Vật tư & Danh mục",
        href: "/inventory/catalog",
        icon: Settings,
        activeIcon: SettingsSolid,
      },
      {
        label: "Hồ sơ nguồn",
        href: "/inventory/acquisitions",
        icon: ClipboardList,
        activeIcon: ClipboardListSolid,
      },
      {
        label: "Nhận kho",
        href: "/inventory/receive",
        icon: Plus,
        activeIcon: PlusSolid,
      },
    ];

    if (isAdmin) {
      inventoryItems.push({
        label: "Tồn đầu kỳ",
        href: "/inventory/opening",
        icon: Import,
        activeIcon: ImportSolid,
      });
    }

    inventoryItems.push(
      {
        label: "Lịch sử giao dịch",
        href: "/inventory/transactions",
        icon: FileClock,
        activeIcon: FileClockSolid,
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
    );

    groups.push({
      label: "Quản lý Kho & Thiết bị",
      items: inventoryItems,
    });
  }

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
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  roomTypeCodes?: string[];
  allowBasicMedicalAccess?: boolean;
  canImportSchedules?: boolean;
  canManagePersonnel?: boolean;
  canManageEmailNotifications?: boolean;
}) {
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
        aria-label="Menu chính"
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
            <strong>MedLabs Calendar</strong>
          </div>
          <button
            className="icon-button sidebar-close"
            onClick={() => setSidebarOpen(false)}
            aria-label="Đóng menu"
            ref={closeButtonRef}
          >
            <PanelLeftClose size={19} />
          </button>
        </div>

        <nav
          aria-label="Điều hướng chính"
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
            return (
              <div className="nav-group" key={group.label}>
                <p className="nav-heading">{group.label}</p>
                {items.map(
                  ({
                    label,
                    href,
                    icon: OutlineIcon,
                    activeIcon: SolidIcon,
                    activeHrefs,
                  }) => {
                    const active =
                      pathname === href ||
                      (href !== "/dashboard" &&
                        href !== "/inventory" &&
                        pathname.startsWith(`${href}/`)) ||
                      Boolean(
                        activeHrefs?.some(
                          (activeHref) => pathname === activeHref,
                        ),
                      );
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
                        <span>{label}</span>
                      </Link>
                    );
                  },
                )}
              </div>
            );
          })}
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
                  <span>Đăng xuất</span>
                </button>
              </form>
            </div>
          ) : null}
          <button
            aria-controls="workspace-account-actions"
            aria-expanded={accountMenuOpen}
            aria-label={`Tài khoản của ${fullName}`}
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
              <span>{primaryRoleLabel}</span>
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
          aria-label="Đóng menu"
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
              aria-label="Mở menu"
              ref={menuButtonRef}
            >
              <Menu size={21} />
            </button>
          }
          title={title}
          description={description}
          actions={
            <>
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
