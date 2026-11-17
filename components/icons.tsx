import type { ComponentType, SVGProps } from "react";
import {
  AcademicCapIcon,
  ArchiveBoxIcon,
  ArrowDownTrayIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowRightStartOnRectangleIcon,
  Bars3Icon,
  BellIcon,
  BookOpenIcon,
  BuildingOffice2Icon,
  CalendarDaysIcon,
  CheckCircleIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClipboardDocumentListIcon,
  ClockIcon,
  CloudArrowUpIcon,
  Cog6ToothIcon,
  DocumentMagnifyingGlassIcon,
  EnvelopeIcon,
  ExclamationCircleIcon,
  ExclamationTriangleIcon,
  LockClosedIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  ShieldCheckIcon,
  Squares2X2Icon,
  TableCellsIcon,
  TrashIcon,
  UserGroupIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import {
  AcademicCapIcon as AcademicCapSolidIcon,
  ArchiveBoxIcon as ArchiveBoxSolidIcon,
  ArrowDownTrayIcon as ArrowDownTraySolidIcon,
  BuildingOffice2Icon as BuildingOffice2SolidIcon,
  CalendarDaysIcon as CalendarDaysSolidIcon,
  ClipboardDocumentListIcon as ClipboardDocumentListSolidIcon,
  ClockIcon as ClockSolidIcon,
  Cog6ToothIcon as Cog6ToothSolidIcon,
  PlusIcon as PlusSolidIcon,
  Squares2X2Icon as Squares2X2SolidIcon,
  UserGroupIcon as UserGroupSolidIcon,
} from "@heroicons/react/24/solid";

type HeroIcon = ComponentType<SVGProps<SVGSVGElement>>;

export type IconProps = Omit<SVGProps<SVGSVGElement>, "width" | "height"> & {
  size?: number;
};

export type AppIcon = ComponentType<IconProps>;

function createIcon(Icon: HeroIcon): AppIcon {
  function CampusIcon({
    size = 24,
    "aria-label": ariaLabel,
    ...props
  }: IconProps) {
    return (
      <Icon
        width={size}
        height={size}
        aria-hidden={ariaLabel ? undefined : "true"}
        aria-label={ariaLabel}
        {...props}
      />
    );
  }

  return CampusIcon;
}

export const BookOpenCheck = createIcon(BookOpenIcon);
export const CalendarDays = createIcon(CalendarDaysIcon);
export const ClipboardList = createIcon(ClipboardDocumentListIcon);
export const FileClock = createIcon(DocumentMagnifyingGlassIcon);
export const GraduationCap = createIcon(AcademicCapIcon);
export const Import = createIcon(ArrowDownTrayIcon);
export const LayoutDashboard = createIcon(Squares2X2Icon);
export const Menu = createIcon(Bars3Icon);
export const Bell = createIcon(BellIcon);
export const PackageCheck = createIcon(ArchiveBoxIcon);
export const PanelLeftClose = createIcon(XMarkIcon);
export const Plus = createIcon(PlusIcon);
export const Settings = createIcon(Cog6ToothIcon);
export const Users = createIcon(UserGroupIcon);
export const Check = createIcon(CheckIcon);
export const ChevronDown = createIcon(ChevronDownIcon);
export const ChevronLeft = createIcon(ChevronLeftIcon);
export const ChevronRight = createIcon(ChevronRightIcon);
export const CircleAlert = createIcon(ExclamationCircleIcon);
export const Clock3 = createIcon(ClockIcon);
export const Search = createIcon(MagnifyingGlassIcon);
export const ShieldCheck = createIcon(ShieldCheckIcon);
export const X = createIcon(XMarkIcon);
export const Trash2 = createIcon(TrashIcon);
export const AlertTriangle = createIcon(ExclamationTriangleIcon);
export const ArrowLeft = createIcon(ArrowLeftIcon);
export const ArrowRight = createIcon(ArrowRightIcon);
export const LogOut = createIcon(ArrowRightStartOnRectangleIcon);
export const Download = createIcon(ArrowDownTrayIcon);
export const FileSpreadsheet = createIcon(TableCellsIcon);
export const UploadCloud = createIcon(CloudArrowUpIcon);
export const Save = createIcon(CheckCircleIcon);
export const LockKeyhole = createIcon(LockClosedIcon);
export const Mail = createIcon(EnvelopeIcon);
export const DoorOpen = createIcon(BuildingOffice2Icon);
export const History = createIcon(ClockIcon);

export const LayoutDashboardSolid = createIcon(Squares2X2SolidIcon);
export const CalendarDaysSolid = createIcon(CalendarDaysSolidIcon);
export const GraduationCapSolid = createIcon(AcademicCapSolidIcon);
export const ClipboardListSolid = createIcon(ClipboardDocumentListSolidIcon);
export const PackageCheckSolid = createIcon(ArchiveBoxSolidIcon);
export const PlusSolid = createIcon(PlusSolidIcon);
export const DoorOpenSolid = createIcon(BuildingOffice2SolidIcon);
export const ImportSolid = createIcon(ArrowDownTraySolidIcon);
export const FileClockSolid = createIcon(ClockSolidIcon);
export const UsersSolid = createIcon(UserGroupSolidIcon);
export const SettingsSolid = createIcon(Cog6ToothSolidIcon);
