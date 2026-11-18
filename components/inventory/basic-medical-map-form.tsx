"use client";

import { useActionState, useState } from "react";
import { mapBasicMedicalItem } from "@/app/inventory/basic-medical-mapping/actions";
import { useLanguage } from "@/components/i18n/language-provider";
import { InventoryLookup } from "@/components/inventory/inventory-lookup";
import type { InventoryCatalogItem } from "@/lib/inventory/types";

/** One unmapped Basic Medical item: pick the SKU, the factor and a reason. */
export function BasicMedicalMapForm({
  itemId,
  unit,
}: {
  itemId: string;
  unit: string | null;
}) {
  const { text } = useLanguage();
  const [state, action, pending] = useActionState(mapBasicMedicalItem, null);
  const [inventoryItemId, setInventoryItemId] = useState("");
  const [label, setLabel] = useState("");
  const [uom, setUom] = useState("");

  return (
    <form action={action} className="list-filters">
      <input type="hidden" name="bm_item_id" value={itemId} />
      <input type="hidden" name="inventory_item_id" value={inventoryItemId} />
      <div className="list-filters-field">
        <span>{text("Mã hàng trong kho")}</span>
        <InventoryLookup<InventoryCatalogItem>
          resource="items"
          filters={{ active: true }}
          value={inventoryItemId}
          valueKey="id"
          label={text("Mã hàng trong kho")}
          id={`bm-map-${itemId}`}
          hideLabel
          selectedLabel={label}
          placeholder={text("Tìm mã hoặc tên vật tư")}
          onSelect={(item) => {
            setInventoryItemId(item.id);
            setLabel(`${item.code} - ${item.name}`);
            setUom(item.base_uom_code);
          }}
        />
      </div>
      <label>
        {text("1 {0} = ? {1}", [
          unit || text("đơn vị"),
          uom || text("ĐVT kho"),
        ])}
        <input name="factor" inputMode="decimal" defaultValue="1" required />
      </label>
      <label>
        {text("Lý do")}
        <input
          name="reason"
          required
          placeholder={text("VD: cùng loại găng")}
        />
      </label>
      <div className="list-filters-actions">
        <button
          type="submit"
          className="button button-primary"
          disabled={pending || !inventoryItemId}
        >
          {text("Ghép")}
        </button>
        {state ? (
          <span
            role="status"
            className={state.ok ? "form-success" : "form-error"}
          >
            {text(state.message)}
          </span>
        ) : null}
      </div>
    </form>
  );
}
