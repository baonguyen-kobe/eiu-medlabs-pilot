import Link from "next/link";
import {
  TABLE_PAGE_SIZE,
  totalPagesFor,
  visiblePageNumbers,
} from "@/lib/pagination";
import { LocalizedElement } from "@/components/i18n/localized-element";

type QueryValues = Record<string, string | number | null | undefined>;

export function PaginationLinks({
  currentPage,
  totalItems,
  pathname,
  query = {},
  pageSize = TABLE_PAGE_SIZE,
}: {
  currentPage: number;
  totalItems: number;
  pathname: string;
  query?: QueryValues;
  pageSize?: number;
}) {
  const totalPages = totalPagesFor(totalItems, pageSize);
  const page = Math.min(Math.max(currentPage, 1), totalPages);
  if (totalPages <= 1) return null;

  const hrefFor = (nextPage: number) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "") {
        params.set(key, String(value));
      }
    }
    if (nextPage > 1) params.set("page", String(nextPage));
    const serialized = params.toString();
    return serialized ? `${pathname}?${serialized}` : pathname;
  };

  const pageLink = (target: number, label: string, disabled: boolean) =>
    disabled ? (
      <span aria-disabled="true" className="is-disabled">
        {label}
      </span>
    ) : (
      <Link href={hrefFor(target)} scroll={false} aria-label={label}>
        {label}
      </Link>
    );

  return (
    <LocalizedElement
      as="nav"
      textAttributes={["aria-label"]}
      className="table-pagination"
      aria-label="Phân trang"
    >
      {pageLink(1, "<<", page === 1)}
      {pageLink(page - 1, "<", page === 1)}
      {visiblePageNumbers(page, totalPages).map((pageNumber) => (
        <Link
          className={pageNumber === page ? "is-current" : undefined}
          aria-current={pageNumber === page ? "page" : undefined}
          href={hrefFor(pageNumber)}
          key={pageNumber}
          scroll={false}
        >
          {pageNumber}
        </Link>
      ))}
      {pageLink(page + 1, ">", page === totalPages)}
      {pageLink(totalPages, ">>", page === totalPages)}
    </LocalizedElement>
  );
}
