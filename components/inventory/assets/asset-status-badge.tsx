import React from "react";
import type {
  AssetLifecycleStatus,
  AssetOperationalStatus,
} from "@/lib/inventory/asset-types";
import { LocalizedText } from "@/components/i18n/language-provider";

type Tone = "info" | "warning" | "success" | "danger" | "neutral";

// UI Master 0A.3 status tones; labels are i18n keys.
const lifecycle: Record<string, [Tone, string]> = {
  in_service: ["success", "Đang vận hành"],
  registered: ["info", "Mới tiếp nhận"],
  inactive: ["neutral", "Tạm ngưng"],
  retired: ["warning", "Ngừng sử dụng"],
  disposed: ["danger", "Đã thanh lý"],
};

const operational: Record<string, [Tone, string]> = {
  ready: ["success", "Sẵn sàng"],
  in_use: ["info", "Đang sử dụng"],
  under_maintenance: ["warning", "Bảo trì"],
  damaged: ["danger", "Hư hỏng"],
  prohibited: ["neutral", "Cấm lưu hành"],
};

function Badge({
  tone,
  label,
  title,
}: {
  tone: Tone;
  label: string;
  title?: string;
}) {
  return (
    <span className="badge" data-tone={tone} title={title}>
      <LocalizedText text={label} />
    </span>
  );
}

export function LifecycleBadge({ status }: { status: AssetLifecycleStatus }) {
  const [tone, label] = lifecycle[status] ?? ["neutral", status];
  return <Badge tone={tone} label={label} />;
}

export function OperationalStatusBadge({
  status,
}: {
  status: AssetOperationalStatus;
}) {
  const [tone, label] = operational[status] ?? ["neutral", status];
  return <Badge tone={tone} label={label} />;
}

export function AssetEligibilityBadge({
  eligible,
  available,
  reasons = [],
}: {
  eligible: boolean;
  available: boolean;
  reasons?: string[];
}) {
  if (available === true) {
    return <Badge tone="success" label="Cấp được" />;
  }
  const why = eligible
    ? "Đủ điều kiện vật lý nhưng đang được giữ hoặc đã cấp cho phiếu khác"
    : reasons.length > 0
      ? reasons.join("; ")
      : "Không đủ điều kiện xuất mượn hoặc vận hành";
  return (
    <Badge
      tone={eligible ? "warning" : "danger"}
      label={eligible ? "Đang bận" : "Không cấp được"}
      title={why}
    />
  );
}
