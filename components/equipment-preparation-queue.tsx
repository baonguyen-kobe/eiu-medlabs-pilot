"use client";

import { useState } from "react";
import Link from "next/link";
import {
  readPreparationQueue,
  savePreparationSettings,
} from "@/app/equipment/preparation/operations-actions";
import {
  preparationQueueFiltersSchema,
  type PreparationQueue,
  type PreparationQueueFilters,
} from "@/lib/equipment-preparation-operations";
import styles from "./equipment-preparation.module.css";

const dateTime = new Intl.DateTimeFormat("vi-VN", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Asia/Ho_Chi_Minh",
});
const preparationLabels: Record<string, string> = {
  draft: "Đang chuẩn bị",
  prepared: "Đã chuẩn bị",
  reversing: "Đang chuyển trả để đảo chuẩn bị",
};
const initialFilters: PreparationQueueFilters = {
  page: 1,
  search: "",
  status: "new",
  sort: "priority",
};

export function EquipmentPreparationQueue({
  initial,
}: {
  initial: PreparationQueue;
}) {
  const [queue, setQueue] = useState(initial);
  const [filters, setFilters] = useState(initialFilters);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("new");
  const [sort, setSort] = useState("priority");
  const [lead, setLead] = useState(
    String(initial.settings.warning_lead_minutes),
  );
  const [inactivity, setInactivity] = useState(
    String(initial.settings.inactivity_minutes),
  );
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function load(next: PreparationQueueFilters) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await readPreparationQueue(next);
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      setQueue(result.data);
      setFilters(next);
    } catch {
      setMessage("Không tải được hàng đợi. Hãy thử lại.");
    } finally {
      setBusy(false);
    }
  }

  async function saveSettings() {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await savePreparationSettings({
        revision: queue.settings.revision,
        warning_lead_minutes: Number(lead),
        inactivity_minutes: Number(inactivity),
        reason,
      });
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      setQueue((current) => ({ ...current, settings: result.data }));
      setReason("");
      const refreshed = await readPreparationQueue(filters);
      if (refreshed.ok) setQueue(refreshed.data);
      setMessage(
        refreshed.ok
          ? "Đã lưu cấu hình và ghi lịch sử. Thời gian khóa mới áp dụng khi bắt đầu/gia hạn khóa."
          : "Đã lưu cấu hình; hãy tải lại hàng đợi để cập nhật mức ưu tiên.",
      );
    } catch {
      setMessage(
        "Không xác nhận được kết quả. Tải lại hàng đợi để đọc phiên bản cấu hình trước khi thử lại.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`${styles.root} space-y-6`}>
      <p>
        Ưu tiên mặc định: quá hạn chuẩn bị → giờ nhận sớm nhất → giờ học sớm
        nhất. Quá hạn chuẩn bị là phiếu Mới đã vào khoảng cảnh báo{" "}
        {queue.settings.warning_lead_minutes} phút trước giờ nhận. Mở phiếu
        không tự nhận việc.
      </p>
      <form
        className="grid gap-3 rounded-xl border p-4 sm:grid-cols-2 lg:grid-cols-4"
        onSubmit={(event) => {
          event.preventDefault();
          const parsed = preparationQueueFiltersSchema.safeParse({
            page: 1,
            search,
            status,
            sort,
          });
          if (parsed.success) void load(parsed.data);
        }}
      >
        <label className="space-y-1">
          Tìm môn, lớp hoặc mã phiếu
          <input
            maxLength={120}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label className="space-y-1">
          Trạng thái
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="new">Mới</option>
            <option value="preparing">Đã chuẩn bị</option>
            <option value="all">Tất cả đang xử lý</option>
          </select>
        </label>
        <label className="space-y-1">
          Sắp xếp
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value)}
          >
            <option value="priority">Ưu tiên chuẩn bị</option>
            <option value="pickup">Giờ nhận</option>
            <option value="class">Giờ học</option>
          </select>
        </label>
        <div className="flex items-end gap-2">
          <button type="submit" className="button" disabled={busy}>
            Áp dụng
          </button>
          <button
            type="button"
            className="button button-secondary"
            disabled={busy}
            onClick={() => void load(filters)}
          >
            Tải lại
          </button>
        </div>
      </form>
      <p role="status" aria-live="polite">
        {message}
      </p>
      <section
        aria-label="Hàng đợi chuẩn bị"
        aria-busy={busy}
        className="space-y-3"
      >
        <p>
          {queue.total} phiếu · Trang {queue.page}/
          {Math.max(1, Math.ceil(queue.total / queue.page_size))}
        </p>
        {queue.rows.length === 0 ? (
          <p className="rounded-xl border p-4">
            Không có phiếu trong phạm vi và bộ lọc hiện tại.
          </p>
        ) : (
          queue.rows.map((row) => (
            <article
              key={row.id}
              className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4 space-y-2"
            >
              <div className="flex flex-wrap justify-between gap-2">
                <h2 className="font-semibold">
                  <Link
                    className="underline"
                    href={`/equipment/preparation/${row.id}`}
                  >
                    {row.course_code} · {row.course_name}
                  </Link>
                </h2>
                <span>
                  {row.status === "new" ? "Mới" : "Đã chuẩn bị"}
                  {row.overdue ? " · Quá hạn chuẩn bị" : ""}
                </span>
              </div>
              <p>
                Lớp {row.class_code ?? "—"} · Nhận{" "}
                {dateTime.format(new Date(row.receive_at))} · Học{" "}
                {dateTime.format(new Date(row.class_at))}
              </p>
              <p>
                {row.preparation_state
                  ? preparationLabels[row.preparation_state]
                  : "Chưa bắt đầu"}{" "}
                · Người chuẩn bị chính:{" "}
                {row.primary_preparer_name ?? "Chưa ghi nhận"}
              </p>
              <p>
                {row.health.length > 0
                  ? "Cần phân bổ lại: nguồn cam kết thiếu hoặc không đủ điều kiện."
                  : row.preparation_state === "prepared"
                    ? "Nguồn cam kết đủ điều kiện tại thời điểm tải."
                    : "Chưa xác nhận sẵn sàng."}
              </p>
              <Link
                className="button button-secondary"
                href={`/equipment/preparation/${row.id}`}
              >
                Mở chi tiết chuẩn bị
              </Link>
            </article>
          ))
        )}
        <nav aria-label="Phân trang hàng đợi" className="flex flex-wrap gap-2">
          <button
            type="button"
            className="button button-secondary"
            disabled={busy || queue.page <= 1}
            onClick={() => void load({ ...filters, page: queue.page - 1 })}
          >
            Trang trước
          </button>
          <button
            type="button"
            className="button button-secondary"
            disabled={
              busy ||
              queue.page * queue.page_size >= queue.total ||
              queue.page >= 100000
            }
            onClick={() => void load({ ...filters, page: queue.page + 1 })}
          >
            Trang sau
          </button>
        </nav>
      </section>
      {queue.admin ? (
        <section className="rounded-xl border p-4 space-y-3">
          <h2 className="text-lg font-semibold">Cấu hình chuẩn bị — Admin</h2>
          <p>
            Áp dụng chung cho Skills Lab. Cảnh báo gửi đến Admin/nhân viên Labs
            trong phạm vi, không gửi khi tự lưu tiến độ. Không thay đổi điều
            kiện đăng ký trước 24 giờ và không tự giải phóng cam kết tồn kho.
          </p>
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void saveSettings();
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <label>
                Cảnh báo trước giờ nhận (phút, 1–10.080)
                <input
                  type="number"
                  required
                  min="1"
                  max="10080"
                  step="1"
                  value={lead}
                  onChange={(event) => setLead(event.target.value)}
                />
              </label>
              <label>
                Hết hạn khóa khi không hoạt động (phút, 1–120)
                <input
                  type="number"
                  required
                  min="1"
                  max="120"
                  step="1"
                  value={inactivity}
                  onChange={(event) => setInactivity(event.target.value)}
                />
              </label>
            </div>
            <p>
              Cấu hình hiện hành: cảnh báo {queue.settings.warning_lead_minutes}{" "}
              phút; khóa {queue.settings.inactivity_minutes} phút · phiên bản{" "}
              {queue.settings.revision}. Khi có xung đột, tải lại, so sánh giá
              trị hiện hành với nội dung đang nhập rồi lưu lại.
            </p>
            <label>
              Lý do thay đổi
              <textarea
                required
                maxLength={1000}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
            <button
              type="submit"
              className="button"
              disabled={busy || !reason.trim()}
            >
              Lưu cấu hình
            </button>
          </form>
        </section>
      ) : null}
    </div>
  );
}
