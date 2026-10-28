import { addExact, compareExact, subtractExact } from "@/lib/inventory/decimal";
import type { Fulfillment } from "@/lib/equipment-fulfillment";
import type { Json } from "@/lib/database.types";
import { LocalizedText } from "@/components/i18n/language-provider";
import { LocalizedElement } from "@/components/i18n/localized-element";

export function FulfillmentReturnPreview({
  workspace,
  rows,
}: {
  workspace: Fulfillment;
  rows: Record<string, Json>[];
}) {
  const totals = new Map<string, { good: string; damaged: string }>();
  for (const row of rows) {
    const key = String(row.issue_slice_id);
    const current = totals.get(key) ?? { good: "0", damaged: "0" };
    if (row.condition === "good")
      current.good = addExact(current.good, String(row.quantity));
    if (row.condition === "damaged")
      current.damaged = addExact(current.damaged, String(row.quantity));
    totals.set(key, current);
  }
  if (!totals.size) return null;
  return (
    <LocalizedElement
      as="section"
      textAttributes={["aria-label"]}
      aria-label="Đối chiếu số nhận lần này"
      className="space-y-2"
    >
      <h3>
        <LocalizedText text={"Kiểm tra lượt nhận trước khi ghi"} />
      </h3>
      {[...totals].map(([id, quantity]) => {
        const issue = workspace.issues.find((row) => row.id === id);
        if (!issue) return null;
        const total = addExact(quantity.good, quantity.damaged);
        const after = addExact(issue.returned, total);
        const remaining = subtractExact(issue.due, total);
        return (
          <p key={id}>
            <strong>
              {issue.item_name} {issue.asset_code ?? ""}
            </strong>
            <LocalizedText text={": thực giao "} />
            {issue.issued}
            <LocalizedText text={"; đã nhận "} />
            {issue.returned}
            <LocalizedText text={"; lần này tốt"} /> {quantity.good}
            <LocalizedText text={" + hỏng "} />
            {quantity.damaged}
            <LocalizedText text={"; sau nhận "} />
            {after}
            <LocalizedText text={"; còn phải trả "} />
            {compareExact(remaining, "0") > 0 ? remaining : "0"}{" "}
            {issue.base_uom_code}
            <LocalizedText
              text={
                ". Trả muộn sẽ đối trừ phần đã xử lý theo quy tắc hiện hành; hàng hold vẫn chờ Admin."
              }
            />
          </p>
        );
      })}
    </LocalizedElement>
  );
}
