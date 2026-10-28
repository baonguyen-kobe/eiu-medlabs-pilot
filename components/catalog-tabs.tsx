import Link from "next/link";
import { LocalizedElement } from "@/components/i18n/localized-element";
import { LocalizedText } from "@/components/i18n/language-provider";

const items = [
  ["/admin/courses", "Môn học"],
  ["/admin/rooms", "Phòng"],
  ["/admin/audit", "Lịch sử thay đổi"],
] as const;

export function CatalogTabs({ active }: { active?: string }) {
  return (
    <LocalizedElement
      as="nav"
      textAttributes={["aria-label"]}
      className="catalog-tabs"
      aria-label="Danh mục quản trị"
    >
      {items.map(([href, label]) => (
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
