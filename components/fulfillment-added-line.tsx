"use client";

import { useRef, useState } from "react";
import { readPreparation } from "@/app/equipment/preparation/actions";
import {
  preparationCatalogSchema,
  preparationSourcesSchema,
  type PreparationCatalog,
  type PreparationSource,
} from "@/lib/equipment-preparation";
import type { Fulfillment } from "@/lib/equipment-fulfillment";
import type { Json } from "@/lib/database.types";
import { useLanguage } from "@/components/i18n/language-provider";
import { LocalizedText } from "@/components/i18n/language-provider";

export function FulfillmentAddedLine({
  workspace,
  disabled,
  onSubmit,
}: {
  workspace: Fulfillment;
  disabled: boolean;
  onSubmit: (payload: Record<string, Json>) => Promise<void>;
}) {
  const { text: uiText } = useLanguage();

  const lineId = useRef(crypto.randomUUID());
  const [search, setSearch] = useState("");
  const [catalog, setCatalog] = useState<PreparationCatalog>({
    rows: [],
    total: 0,
    page: 1,
  });
  const [catalogId, setCatalogId] = useState("");
  const [sources, setSources] = useState<PreparationSource[]>([]);
  const [sourceIndex, setSourceIndex] = useState(-1);
  const [sourcePage, setSourcePage] = useState(1);
  const [reference, setReference] = useState(workspace.lines[0]?.id ?? "");
  const [quantity, setQuantity] = useState("1");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  async function loadCatalog(page = 1) {
    setLoading(true);
    setMessage("");
    try {
      const result = await readPreparation(workspace.request_id, "catalog", {
        search,
        page,
      });
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      setCatalog(preparationCatalogSchema.parse(result.data));
    } catch {
      setMessage("Không tải được danh mục. Hãy thử lại.");
    } finally {
      setLoading(false);
    }
  }
  async function loadSources(page = 1) {
    setLoading(true);
    setMessage("");
    try {
      const result = await readPreparation(workspace.request_id, "stock", {
        catalog_item_id: catalogId,
        page,
      });
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      const data = preparationSourcesSchema.parse(result.data);
      setSources(data.rows);
      setSourcePage(page);
      setSourceIndex(-1);
      if (!data.rows.length)
        setMessage(
          "Chưa có nguồn mapping tại trang này. SKU chưa được cấu hình mapping phải hoàn tất cấu hình trước; không tự suy ra quy đổi theo tên.",
        );
    } catch {
      setMessage("Không tải được nguồn. Hãy thử lại.");
    } finally {
      setLoading(false);
    }
  }
  return (
    <section aria-label={uiText("Dụng cụ phát sinh sau giao")}>
      <h2>{uiText("Ghi nhận dụng cụ mới phát sinh")}</h2>
      <p>
        {uiText(
          "Chuyên viên ghi nhận yêu cầu và lý do. Thao tác này chưa giữ hoặc xuất kho; sau đó chọn dòng mới để thực giao bổ sung. Không thay số đăng ký gốc hay chữ ký trước.",
        )}
      </p>
      <fieldset disabled={disabled || loading}>
        <label>
          {uiText("Tìm trong danh mục")}
          <input
            value={search}
            maxLength={120}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="button button-secondary"
          onClick={() => void loadCatalog()}
        >
          {uiText("Tìm dụng cụ")}
        </button>
        <label>
          {uiText("Dụng cụ mới")}
          <select
            value={catalogId}
            onChange={(event) => {
              setCatalogId(event.target.value);
              setSources([]);
              setSourceIndex(-1);
            }}
          >
            <option value="">{uiText("Chọn dụng cụ")}</option>
            {catalog.rows
              .filter(
                (item) =>
                  !workspace.lines.some(
                    (line) => line.catalog_item_id === item.id,
                  ),
              )
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.commercial_name} · {item.unit}
                </option>
              ))}
          </select>
        </label>
        <button
          type="button"
          className="button button-secondary"
          disabled={catalog.page <= 1}
          onClick={() => void loadCatalog(catalog.page - 1)}
        >
          {uiText("Danh mục trước")}
        </button>{" "}
        <button
          type="button"
          className="button button-secondary"
          disabled={catalog.page * 100 >= catalog.total}
          onClick={() => void loadCatalog(catalog.page + 1)}
        >
          {uiText("Danh mục tiếp")}
        </button>
        <label>
          {uiText("Thuộc bài thực hành của dòng")}
          <select
            value={reference}
            onChange={(event) => setReference(event.target.value)}
          >
            {workspace.lines.map((line) => (
              <option key={line.id} value={line.id}>
                {line.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {uiText("Số lượng yêu cầu phát sinh (đơn vị đăng ký)")}
          <input
            inputMode="numeric"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="button button-secondary"
          disabled={!catalogId}
          onClick={() => void loadSources()}
        >
          {uiText("Tra mapping và nguồn")}
        </button>
        <label>
          {uiText("Mapping đã cấu hình")}
          <select
            value={sourceIndex}
            onChange={(event) => setSourceIndex(Number(event.target.value))}
          >
            <option value={-1}>{uiText("Chọn mapping/nguồn")}</option>
            {sources.map((source, index) => (
              <option
                key={`${source.mapping_id}:${source.location_id}`}
                value={index}
              >
                {source.item_name} · {source.location_name}
                {uiText(" · quy đổi")} {source.conversion_factor}{" "}
                {source.base_uom_code}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="button button-secondary"
          disabled={!catalogId || sourcePage <= 1}
          onClick={() => void loadSources(sourcePage - 1)}
        >
          {uiText("Nguồn trước")}
        </button>{" "}
        <button
          type="button"
          className="button button-secondary"
          disabled={!catalogId || sources.length < 100}
          onClick={() => void loadSources(sourcePage + 1)}
        >
          {uiText("Nguồn tiếp")}
        </button>
        <label>
          {uiText("Lý do / nguồn yêu cầu từ giảng viên")}
          <textarea
            maxLength={1000}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="button"
          disabled={
            sourceIndex < 0 ||
            !reference ||
            !reason.trim() ||
            !/^[1-9]\d{0,9}$/.test(quantity) ||
            Number(quantity) > 2147483647
          }
          onClick={() => {
            const source = sources[sourceIndex];
            if (!source) return;
            void onSubmit({
              line_id: lineId.current,
              reference_line_id: reference,
              mapping_id: source.mapping_id,
              location_id: source.location_id,
              requested_quantity: quantity,
              reason,
            });
          }}
        >
          {uiText("Ghi nhận phát sinh — chưa xuất kho")}
        </button>
      </fieldset>
      <p role="status">
        <LocalizedText text={message ?? ""} />
      </p>
    </section>
  );
}
