"use client";

import { createClient } from "@/lib/supabase/client";
import { useEffect, useState } from "react";
import { useLanguage } from "@/components/i18n/language-provider";

type LifecycleAuditEntry = {
  created_at: string;
  action: string;
  actor_id: string | null;
  actor_name: string | null;
  old_status: string | null;
  new_status: string | null;
  metadata: Record<string, unknown>;
};

const actionLabels: Record<string, string> = {
  "equipment_request.cancelled": "Phiếu đã được hủy",
  "equipment_request.hard_deleted": "Phiếu đã được xóa",
  "equipment_request.status_changed": "Điều chỉnh trạng thái phiếu",
  "equipment_request.handover_staff_confirmed": "Kho xác nhận giao",
  "equipment_request.handover_recipient_signed": "Người nhận ký xác nhận giao",
  "equipment_request.return_staff_confirmed": "Kho xác nhận trả",
  "equipment_request.return_recipient_signed": "Người nhận ký xác nhận trả",
};

const statusLabels: Record<string, string> = {
  new: "Mới",
  preparing: "Đã soạn",
  handed_over: "Đã giao",
  returned: "Đã trả",
  completed: "Hoàn thành",
  cancelled: "Đã hủy",
};

function displayTime(value: string) {
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(new Date(value));
}

export function EquipmentRequestLifecycleHistory({
  requestId,
}: {
  requestId: string;
}) {
  const { text: uiText } = useLanguage();

  const [entries, setEntries] = useState<LifecycleAuditEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    let active = true;
    void supabase
      .rpc("list_equipment_request_lifecycle_audit", {
        target_request_id: requestId,
      })
      .then(({ data }) => {
        if (active) {
          setEntries((data ?? []) as LifecycleAuditEntry[]);
          setLoaded(true);
        }
      });
    return () => {
      active = false;
    };
  }, [requestId]);

  return (
    <section
      className="equipment-lifecycle-history"
      aria-label={uiText("Lịch sử xử lý")}
    >
      <h3>{uiText("Lịch sử xử lý")}</h3>
      {!loaded ? <p>{uiText("Đang tải lịch sử…")}</p> : null}
      {loaded && !entries.length ? (
        <p>{uiText("Chưa có thao tác xử lý.")}</p>
      ) : null}
      {entries.length ? (
        <ol>
          {entries.map((entry, index) => {
            const transition =
              entry.old_status && entry.new_status
                ? `${uiText(statusLabels[entry.old_status] ?? entry.old_status)} → ${uiText(statusLabels[entry.new_status] ?? entry.new_status)}`
                : null;
            return (
              <li key={`${entry.created_at}-${entry.action}-${index}`}>
                <strong>
                  {uiText(actionLabels[entry.action] ?? entry.action)}
                </strong>
                {transition ? <span>{transition}</span> : null}
                <small>
                  {displayTime(entry.created_at)}
                  {entry.actor_name ? ` · ${entry.actor_name}` : ""}
                </small>
              </li>
            );
          })}
        </ol>
      ) : null}
    </section>
  );
}
