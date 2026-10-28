"use client";

import { useState } from "react";
import { readPreparation } from "@/app/equipment/preparation/actions";
import {
  preparationCatalogSchema,
  type PreparationAddedTarget,
  type PreparationCatalog,
} from "@/lib/equipment-preparation";
import { useLanguage } from "@/components/i18n/language-provider";
import { LocalizedText } from "@/components/i18n/language-provider";

export function PreparationAddedLine({
  requestId,
  activities,
  disabled,
  title,
  actionLabel,
  onAdd,
}: {
  requestId: string;
  activities: string[];
  disabled: boolean;
  title: string;
  actionLabel: string;
  onAdd: (target: PreparationAddedTarget, reason: string) => Promise<boolean>;
}) {
  const { text: uiText } = useLanguage();

  const [search, setSearch] = useState("");
  const [catalog, setCatalog] = useState<PreparationCatalog | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function load(page: number) {
    setBusy(true);
    setError("");
    try {
      const result = await readPreparation(requestId, "catalog", {
        search,
        page,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setCatalog(preparationCatalogSchema.parse(result.data));
    } catch {
      setError("Không tải được danh mục thiết bị.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="rounded-xl border p-4 space-y-3">
      <summary className="font-semibold">{uiText(title)}</summary>
      <p>
        {uiText(
          "Dòng mới độc lập có baseline đăng ký bằng 0. Không đổi thiết bị gốc thành SKU thay thế theo tên.",
        )}
      </p>
      <label>
        {uiText("Tìm thiết bị đăng ký")}
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          maxLength={120}
        />
      </label>
      <button
        type="button"
        className="button button-secondary"
        disabled={disabled || busy}
        onClick={() => void load(1)}
      >
        {uiText("Tìm thiết bị")}
      </button>
      <form
        className="space-y-3"
        onSubmit={async (event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          const item = catalog?.rows.find(
            (row) => row.id === data.get("catalog"),
          );
          if (!item) {
            setError("Chọn một thiết bị từ danh mục đã tải.");
            return;
          }
          setBusy(true);
          setError("");
          try {
            const ok = await onAdd(
              {
                line_id: crypto.randomUUID(),
                catalog_item_id: item.id,
                commercial_name: item.commercial_name,
                item_name: item.item_name,
                unit: item.unit,
                skill_name: String(data.get("activity")),
                quantity: String(data.get("quantity")),
                note: String(data.get("note")),
              },
              String(data.get("reason")),
            );
            if (ok) form.reset();
          } catch {
            setError(
              "Không ghi nhận được dòng mới; dữ liệu vẫn được giữ để thử lại.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset disabled={disabled || busy} className="space-y-3">
          <label>
            {uiText("Thiết bị")}
            <select name="catalog" required defaultValue="">
              <option value="" disabled>
                {uiText("Chọn thiết bị")}
              </option>
              {catalog?.rows.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.commercial_name || item.item_name} · {item.unit}
                </option>
              ))}
            </select>
          </label>
          {catalog ? (
            <div className="flex gap-2">
              <button
                type="button"
                className="button button-secondary"
                disabled={catalog.page === 1}
                onClick={() => void load(catalog.page - 1)}
              >
                {uiText("Danh mục trước")}
              </button>
              <span>
                {catalog.page} / {Math.max(1, Math.ceil(catalog.total / 100))}
              </span>
              <button
                type="button"
                className="button button-secondary"
                disabled={catalog.page * 100 >= catalog.total}
                onClick={() => void load(catalog.page + 1)}
              >
                {uiText("Danh mục tiếp")}
              </button>
            </div>
          ) : null}
          <label>
            {uiText("Hoạt động đã đăng ký")}
            <select name="activity" required>
              {activities.map((activity) => (
                <option key={activity} value={activity}>
                  {activity}
                </option>
              ))}
            </select>
          </label>
          <label>
            {uiText("SL tuyệt đối")}
            <input
              name="quantity"
              inputMode="numeric"
              pattern="[1-9][0-9]*"
              required
              defaultValue="1"
            />
          </label>
          <label>
            {uiText("Ghi chú")}
            <input name="note" maxLength={1000} />
          </label>
          <label>
            {uiText("Lý do thêm dòng")}
            <textarea name="reason" required maxLength={1000} />
          </label>
          <button type="submit" className="button">
            {actionLabel}
          </button>
        </fieldset>
      </form>
      {error ? (
        <p role="alert">
          <LocalizedText text={error ?? ""} />
        </p>
      ) : null}
    </details>
  );
}
