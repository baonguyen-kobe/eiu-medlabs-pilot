import Link from "next/link";
import { LocalizedElement } from "@/components/i18n/localized-element";
import { LocalizedText } from "@/components/i18n/language-provider";

type Scope = "admin" | "basicMedical" | "inventory";

// One "Danh mục" place (t4c): every catalog page shows the tabs its viewer
// may open. Admin-only pages keep the defaults (all tabs).
const items: Array<[string, string, Scope]> = [
  ["/admin/equipment", "Thiết bị Skills lab", "admin"],
  ["/basic-medical/equipment", "Thiết bị Y cơ sở", "basicMedical"],
  ["/inventory/catalog", "Vật tư kho", "inventory"],
  ["/admin/courses", "Môn học", "admin"],
  ["/admin/rooms", "Phòng", "admin"],
  ["/admin/equipment-scopes", "Phạm vi thiết bị", "admin"],
  ["/admin/audit", "Lịch sử thay đổi", "admin"],
];

export function CatalogTabs({
  active,
  canAdmin = true,
  canBasicMedical = true,
  canInventory = true,
}: {
  active?: string;
  canAdmin?: boolean;
  canBasicMedical?: boolean;
  canInventory?: boolean;
}) {
  const allowed: Record<Scope, boolean> = {
    admin: canAdmin,
    basicMedical: canBasicMedical,
    inventory: canInventory,
  };
  const visible = items.filter(([, , scope]) => allowed[scope]);
  if (visible.length < 2) return null;
  return (
    <LocalizedElement
      as="nav"
      textAttributes={["aria-label"]}
      className="catalog-tabs"
      aria-label="Danh mục"
    >
      {visible.map(([href, label]) => (
        <Link
          aria-current={active === href ? "page" : undefined}
          className={active === href ? "active" : ""}
          href={href}
          key={href}
        >
          <LocalizedText text={label} />
        </Link>
      ))}
    </LocalizedElement>
  );
}
