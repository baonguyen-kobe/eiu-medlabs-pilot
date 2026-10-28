import type { Fulfillment } from "@/lib/equipment-fulfillment";
import { LocalizedText } from "@/components/i18n/language-provider";

export const effectLabels: Record<string, string> = {
  issue: "Thực giao",
  receipt: "Thực nhận",
  issue_correction: "Bù trừ giao",
  resolution: "Xử lý không thu hồi",
  consequence: "Xử lý tài sản",
  hold: "Tạm giữ đối soát",
  reconciliation: "Đối soát tạm giữ",
};

export function FulfillmentEventEvidence({
  event,
}: {
  event: Fulfillment["events"][number];
}) {
  return (
    <div className="space-y-2">
      <p>
        <LocalizedText text={"Người ghi nhận / chuyên viên tiếp nhận: "} />
        {event.actor_id}
      </p>
      {typeof event.payload.carrier_name === "string" ? (
        <p>
          <LocalizedText text={"Người mang trả: "} />
          {event.payload.carrier_name}
        </p>
      ) : null}
      {(event.display_lines ?? []).map((line) => (
        <p key={line.id}>
          <LocalizedText text={effectLabels[line.kind] ?? line.kind} />:{" "}
          <strong>{line.item_name}</strong>
          {line.asset_code ? ` · ${line.asset_code}` : ""} — {line.quantity}{" "}
          {line.unit}
          {line.condition ? (
            <>
              <span> · </span>
              <LocalizedText
                text={line.condition === "good" ? "tốt" : "hỏng"}
              />
            </>
          ) : (
            ""
          )}
        </p>
      ))}
      {!event.display_lines?.length ? (
        <p>
          <LocalizedText
            text={"Không có dòng chuyển động số lượng trong sự kiện này."}
          />
        </p>
      ) : null}
      <p>
        <LocalizedText
          text={
            "Tên là nhãn danh mục tra cứu hiện tại; số lượng và mã nguồn thuộc sự kiện bất biến. Mã sự kiện: "
          }
        />
        {event.id}.
      </p>
      <p>
        <LocalizedText text={"Mã kiểm chứng snapshot:"} />{" "}
        <span className="break-all">{event.snapshot_hash}</span>
      </p>
    </div>
  );
}
