"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { z } from "zod";
import {
  equipmentOperationHref,
  equipmentOperationsSchema,
  operationPhases,
} from "@/lib/equipment-operations";
import { PaginationLinks } from "@/components/pagination-links";
import { useLanguage } from "@/components/i18n/language-provider";

type Queue = z.infer<typeof equipmentOperationsSchema>;
type Row = Queue["rows"][number];
type Phase = keyof typeof operationPhases;

const phaseTone: Record<Phase, string> = {
  all: "kpi-navy",
  prepare: "kpi-navy",
  handover: "kpi-teal",
  signature: "kpi-gold",
  return: "kpi-gold",
  hold: "kpi-danger",
};

const dateParts = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "Asia/Ho_Chi_Minh",
});

/** dd/mm/yyyy hh:mm in Vietnam time. */
function formatWhen(iso: string) {
  const part = Object.fromEntries(
    dateParts.formatToParts(new Date(iso)).map((p) => [p.type, p.value]),
  );
  return `${part.day}/${part.month}/${part.year} ${part.hour}:${part.minute}`;
}

function step(row: Row): { label: string; tone: string } {
  if (!row.has_preparation && row.status !== "new")
    return { label: "Chỉ xem", tone: "neutral" };
  if (row.status === "new") return { label: "Cần chuẩn bị", tone: "info" };
  if (row.status === "preparing") return { label: "Chờ giao", tone: "info" };
  if (row.status === "completed")
    return { label: "Đã hoàn tất", tone: "neutral" };
  return { label: "Đã giao", tone: "success" };
}

export function OperationsQueue({
  phase,
  search,
  page,
  queue,
  phaseCounts,
}: {
  phase: Phase;
  search: string;
  page: number;
  queue: Queue;
  phaseCounts: Record<Phase, number | null>;
}) {
  const { text } = useLanguage();
  const router = useRouter();

  return (
    <>
      <section className="kpi-grid" aria-label={text("Việc theo bước")}>
        {(Object.keys(operationPhases) as Phase[]).map((key) => (
          <Link
            key={key}
            href={
              key === "all"
                ? "/equipment/operations"
                : `/equipment/operations?phase=${key}`
            }
            scroll={false}
            className={`kpi-card kpi-filter ${phaseTone[key]}`}
            aria-current={phase === key ? "true" : undefined}
          >
            <span>{text(operationPhases[key])}</span>
            <strong>{phaseCounts[key] ?? "—"}</strong>
            <small>{text("phiếu")}</small>
          </Link>
        ))}
      </section>

      <form method="get" className="list-filters">
        <input type="hidden" name="phase" value={phase} />
        <label>
          {text("Tìm kiếm")}
          <input
            name="search"
            defaultValue={search}
            maxLength={120}
            placeholder={text("Môn, lớp hoặc người phụ trách")}
          />
        </label>
        <div className="list-filters-actions">
          <button type="submit" className="button button-primary">
            {text("Lọc")}
          </button>
          {search ? (
            <Link
              href={
                phase === "all"
                  ? "/equipment/operations"
                  : `/equipment/operations?phase=${phase}`
              }
              className="button button-secondary"
            >
              {text("Xóa bộ lọc")}
            </Link>
          ) : null}
          <Link
            href="/equipment/preparation"
            className="button button-secondary"
          >
            {text("Hàng đợi chuẩn bị")}
          </Link>
          <span className="inline-toolbar-count">
            {text("{0} phiếu", [queue.total])}
          </span>
        </div>
      </form>

      {queue.rows.length === 0 ? (
        <p className="panel-empty">
          {text("Không có việc nào trong bước và bộ lọc này.")}
        </p>
      ) : (
        <div className="data-panel">
          <div className="responsive-table">
            <table className="data-table records-on-phone">
              <thead>
                <tr>
                  <th>{text("Phiếu")}</th>
                  <th>{text("Phụ trách")}</th>
                  <th>{text("Nhận")}</th>
                  <th>{text("Trả")}</th>
                  <th>{text("Bước")}</th>
                  <th>{text("Cần làm")}</th>
                </tr>
              </thead>
              <tbody>
                {queue.rows.map((row) => {
                  const href = equipmentOperationHref(row);
                  const current = step(row);
                  return (
                    <tr
                      key={row.id}
                      className="row-link"
                      onClick={() => router.push(href)}
                    >
                      <td data-label={text("Phiếu")}>
                        <span className="cell-stack">
                          <Link
                            href={href}
                            className="link-button"
                            onClick={(event) => event.stopPropagation()}
                          >
                            {row.course_code} · {row.course_name}
                          </Link>
                          <small>{row.class_code ?? "—"}</small>
                        </span>
                      </td>
                      <td data-label={text("Phụ trách")}>
                        {row.responsible_name || text("Chưa ghi nhận")}
                      </td>
                      <td data-label={text("Nhận")}>
                        {formatWhen(row.receive_at)}
                      </td>
                      <td data-label={text("Trả")}>
                        {formatWhen(row.return_at)}
                      </td>
                      <td data-label={text("Bước")}>
                        <span className="badge" data-tone={current.tone}>
                          {text(current.label)}
                        </span>
                      </td>
                      <td data-label={text("Cần làm")}>
                        <Todo row={row} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <PaginationLinks
        currentPage={page}
        totalItems={queue.total}
        pageSize={queue.page_size}
        pathname="/equipment/operations"
        query={{ phase: phase === "all" ? undefined : phase, search }}
      />
    </>
  );
}

/** Only open obligations are listed; a row with nothing pending shows none. */
function Todo({ row }: { row: Row }) {
  const { text } = useLanguage();
  const items: Array<{ label: string; tone: string }> = [];
  if (["pending", "rejected"].includes(row.late_approval_status ?? ""))
    items.push({ label: text("Duyệt đăng ký muộn"), tone: "warning" });
  if (row.unsigned_count > 0)
    items.push({
      label: text("Chờ ký {0}", [row.unsigned_count]),
      tone: "warning",
    });
  if (row.due_line_count > 0)
    items.push(
      row.return_overdue
        ? {
            label: text("Quá hạn trả {0}", [row.due_line_count]),
            tone: "danger",
          }
        : { label: text("Còn trả {0}", [row.due_line_count]), tone: "warning" },
    );
  if (row.hold_line_count > 0)
    items.push({
      label: text("Chờ đối soát {0}", [row.hold_line_count]),
      tone: "danger",
    });
  if (!items.length) return null;
  return (
    <span className="cell-stack">
      {items.map((item) => (
        <span key={item.label} className="badge" data-tone={item.tone}>
          {item.label}
        </span>
      ))}
    </span>
  );
}
