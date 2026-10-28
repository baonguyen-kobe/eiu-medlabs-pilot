"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import {
  changeFulfillment,
  readFulfillment,
} from "@/app/equipment/fulfillment/actions";
import { readPreparation } from "@/app/equipment/preparation/actions";
import {
  preparationSourcesSchema,
  preparationAssetsSchema,
  type PreparationSource,
  type PreparationAsset,
} from "@/lib/equipment-preparation";
import {
  fulfillmentLabels,
  type Fulfillment,
  type FulfillmentOperation,
} from "@/lib/equipment-fulfillment";
import type { Json } from "@/lib/database.types";
import { equipmentRequestStatuses } from "@/lib/equipment-requests";
import {
  addExact,
  compareExact,
  isPositive,
  subtractExact,
  validateDecimalString,
} from "@/lib/inventory/decimal";
import { FulfillmentAddedLine } from "./fulfillment-added-line";
import { FulfillmentEventEvidence } from "./fulfillment-event-evidence";
import { FulfillmentReturnPreview } from "./fulfillment-return-preview";
import styles from "./equipment-preparation.module.css";
import { useLanguage } from "@/components/i18n/language-provider";
import { LocalizedText } from "@/components/i18n/language-provider";

type Entry = Record<string, Json>;
const dateTime = new Intl.DateTimeFormat("vi-VN", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Asia/Ho_Chi_Minh",
});

export function EquipmentFulfillmentWorkspace({
  initial,
}: {
  initial: Fulfillment;
}) {
  const { text: uiText } = useLanguage();

  const [workspace, setWorkspace] = useState(initial);
  const [carrierName, setCarrierName] = useState("");
  const [operation, setOperation] = useState<FulfillmentOperation>(
    initial.status === "preparing"
      ? "handover"
      : ["returned", "completed"].includes(initial.status)
        ? "recover"
        : "initial_return",
  );
  const [correction, setCorrection] = useState("");
  const [reason, setReason] = useState("");
  const [evidence, setEvidence] = useState("");
  const [rows, setRows] = useState<Entry[]>([]);
  const [lineId, setLineId] = useState(initial.lines[0]?.id ?? "");
  const [sources, setSources] = useState<PreparationSource[]>([]);
  const [sourceIndex, setSourceIndex] = useState(-1);
  const [sourcePage, setSourcePage] = useState(1);
  const [assets, setAssets] = useState<PreparationAsset[]>([]);
  const [assetIds, setAssetIds] = useState<string[]>([]);
  const [assetPage, setAssetPage] = useState(1);
  const [assetTotal, setAssetTotal] = useState(0);
  const [sliceId, setSliceId] = useState(initial.issues[0]?.id ?? "");
  const [locationId, setLocationId] = useState(initial.locations[0]?.id ?? "");
  const [quantity, setQuantity] = useState("1");
  const [condition, setCondition] = useState("good");
  const [classification, setClassification] = useState("waived");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [message, setMessage] = useState("");
  const [signingId, setSigningId] = useState("");
  const [signature, setSignature] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const hasInk = useRef(false);
  const pending = useRef<{
    fingerprint: string;
    key: string;
    payload: Entry;
    operation: FulfillmentOperation;
  } | null>(null);
  const target = workspace.events.find((event) => event.id === correction);
  const effectiveOperation =
    operation === "correct"
      ? String(target?.payload.effective_operation ?? target?.operation ?? "")
      : operation;
  const issuing =
    effectiveOperation === "handover" || effectiveOperation === "supplement";
  const receiving =
    effectiveOperation === "initial_return" || effectiveOperation === "recover";
  const administrative =
    effectiveOperation === "consequence" || effectiveOperation === "reconcile";
  const selectableIssues = workspace.issues.filter(
    (issue) => !receiving || issue.return_required,
  );
  const selectedIssue = selectableIssues.find((issue) => issue.id === sliceId);
  const selectedSource = sources[sourceIndex];
  const signEvent = workspace.events.find((event) => event.id === signingId);

  async function refresh(nextPage = page) {
    if (uncertain && pending.current) {
      await retryPending();
      return;
    }
    setBusy(true);
    try {
      const result = await readFulfillment(workspace.request_id, nextPage);
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      setWorkspace(result.data);
      setPage(nextPage);
      pending.current = null;
      setMessage(
        "Đã tải phiên bản hiện tại. Dữ liệu đang nhập được giữ; kiểm tra trước khi ghi nhận.",
      );
    } catch {
      setMessage("Không tải được phiếu. Dữ liệu đang nhập được giữ.");
    } finally {
      setBusy(false);
    }
  }

  async function submit(op: FulfillmentOperation, body: Entry) {
    if (busy) return;
    const fingerprint = JSON.stringify({
      op,
      revision: workspace.revision,
      body,
    });
    if (uncertain) {
      setMessage(
        "Phải đối soát thao tác chưa rõ kết quả trước khi tạo sự kiện khác.",
      );
      return;
    }
    if (pending.current?.fingerprint !== fingerprint)
      pending.current = {
        fingerprint,
        key: crypto.randomUUID(),
        payload: {
          ...body,
          expected_revision: workspace.revision,
          business_key: crypto.randomUUID(),
        },
        operation: op,
      };
    await retryPending();
  }

  async function retryPending() {
    const command = pending.current;
    if (!command || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await changeFulfillment(
        workspace.request_id,
        command.operation,
        command.payload,
        command.key,
      );
      if (!result.ok) {
        setMessage(result.error);
        setUncertain(
          (previous) =>
            previous ||
            ("committed" in result && result.committed === true) ||
            ("uncertain" in result && result.uncertain === true),
        );
        return;
      }
      setWorkspace(result.data);
      setPage(1);
      if (command.operation === "handover") setOperation("initial_return");
      if (command.operation === "initial_return") setOperation("recover");
      pending.current = null;
      setUncertain(false);
      setRows([]);
      setReason("");
      setCarrierName("");
      setEvidence("");
      setConfirmed(false);
      setSigningId("");
      setSignature("");
      setMessage("Đã ghi nhận. Sự kiện vật lý và chữ ký được lưu riêng.");
    } catch {
      setUncertain(true);
      setMessage(
        "Chưa rõ kết quả do mất kết nối. Bấm đối soát để gửi lại đúng mã và nội dung; không tạo sự kiện mới.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function loadSources(nextPage = 1) {
    const line = workspace.lines.find((item) => item.id === lineId);
    if (!line) return;
    setBusy(true);
    try {
      const result = await readPreparation(workspace.request_id, "stock", {
        catalog_item_id: line.catalog_item_id,
        page: nextPage,
      });
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      setSources(preparationSourcesSchema.parse(result.data).rows);
      setSourcePage(nextPage);
      setSourceIndex(-1);
      setAssets([]);
      setAssetIds([]);
    } catch {
      setMessage("Không tải được nguồn đủ điều kiện.");
    } finally {
      setBusy(false);
    }
  }

  async function loadAssets(nextPage = 1) {
    if (!selectedSource) return;
    setBusy(true);
    try {
      const result = await readPreparation(workspace.request_id, "assets", {
        inventory_item_id: selectedSource.inventory_item_id,
        location_id: selectedSource.location_id,
        page: nextPage,
      });
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      const parsed = preparationAssetsSchema.parse(result.data);
      setAssets(parsed.rows);
      setAssetPage(nextPage);
      setAssetTotal(parsed.total);
    } catch {
      setMessage("Không tải được tài sản.");
    } finally {
      setBusy(false);
    }
  }

  function addRow() {
    if (
      !/^\d+(\.\d{1,6})?$/.test(quantity) ||
      !validateDecimalString(quantity).valid
    ) {
      setMessage("Nhập số lượng chính xác, tối đa 6 chữ số thập phân.");
      return;
    }
    if (issuing) {
      if (!selectedSource) {
        setMessage("Chọn nguồn trước khi thêm.");
        return;
      }
      setRows((current) => [
        ...current,
        {
          line_id: lineId,
          mapping_id: selectedSource.mapping_id,
          location_id: selectedSource.location_id,
          quantity,
          asset_ids: assetIds,
        },
      ]);
    } else {
      if (!selectedIssue) {
        setMessage("Chọn phần thực giao cần xử lý.");
        return;
      }
      if (receiving) {
        if (!isPositive(quantity)) {
          setMessage(
            "Số nhận của lần này phải lớn hơn 0. Lượt đầu chưa nhận đồ có thể để danh sách rỗng.",
          );
          return;
        }
        if (
          rows.some(
            (row) =>
              row.issue_slice_id === sliceId && row.condition === condition,
          )
        ) {
          setMessage(
            "Dòng và tình trạng này đã có trong lượt nhận. Bỏ dòng cũ trước khi nhập lại.",
          );
          return;
        }
        const queued = rows
          .filter((row) => row.issue_slice_id === sliceId)
          .reduce((sum, row) => addExact(sum, String(row.quantity)), quantity);
        if (
          compareExact(
            queued,
            subtractExact(selectedIssue.issued, selectedIssue.returned),
          ) > 0 &&
          operation !== "correct"
        ) {
          setMessage(
            "Số nhận trong lượt vượt phần thực giao chưa nhận lại. Kiểm tra đúng phiếu và dụng cụ.",
          );
          return;
        }
      }
      setRows((current) => [
        ...current,
        {
          issue_slice_id: selectedIssue.id,
          quantity,
          ...(receiving
            ? { location_id: locationId, condition }
            : { classification }),
        },
      ]);
    }
    setMessage("");
  }

  function post() {
    if (!confirmed || !reason.trim()) {
      setMessage("Cần lý do và xác nhận sự kiện thực tế trước khi ghi nhận.");
      return;
    }
    void submit(operation, {
      reason,
      ...(receiving && operation !== "correct" && carrierName.trim()
        ? { carrier_name: carrierName.trim() }
        : {}),
      ...(operation === "recover" ? { return_entry_mode: "incremental" } : {}),
      ...(operation === "correct" ? { event_id: correction } : {}),
      ...(administrative
        ? { issue_slice_id: sliceId, quantity, classification, evidence }
        : { lines: rows }),
    });
  }

  const locked = busy || uncertain;
  return (
    <div className={styles.root}>
      <p>
        <Link href="/equipment/operations">{uiText("Công việc kho")}</Link> ·{" "}
        <Link href="/equipment/requests">{uiText("Danh sách phiếu")}</Link> ·{" "}
        <Link href={`/equipment/preparation/${workspace.request_id}`}>
          {uiText("Chuẩn bị")}
        </Link>
      </p>
      {workspace.manager ? (
        <a
          className="button button-secondary"
          href={`/api/equipment-requests/${workspace.request_id}/handover`}
        >
          {uiText("Xuất bằng chứng giao nhận PDF")}
        </a>
      ) : null}
      <p>
        {uiText("Trạng thái: ")}
        <strong>
          {uiText(
            equipmentRequestStatuses.find(
              ({ value }) => value === workspace.status,
            )?.label ?? workspace.status,
          )}
        </strong>
        {uiText(" · Phiên bản")} {workspace.revision}
        {uiText(". Chữ ký không tạo thêm xuất/nhập kho.")}
      </p>
      <button
        className="button button-secondary"
        disabled={busy}
        onClick={() => void refresh()}
      >
        {uiText("Tải phiên bản mới")}
      </button>
      <p role="status">
        <LocalizedText text={message ?? ""} />
      </p>
      <section>
        <h2>{uiText("Đăng ký và kế hoạch")}</h2>
        {workspace.status === "preparing" ? (
          <p>
            {uiText(
              "Khi thực giao lần đầu, toàn bộ phần giữ của kế hoạch sẽ được nhả. Phần chưa giao không còn được dành riêng; giao bổ sung phải kiểm tra lại nguồn.",
            )}
          </p>
        ) : null}
        {workspace.lines.map((line) => (
          <p key={line.id}>
            {line.name}
            {uiText(": đăng ký gốc ")}
            {line.registered_quantity}
            {uiText(", kế hoạch")} {line.planned_quantity} {line.unit}
            {line.baseline_source === "added"
              ? uiText(" · Phát sinh {0} {1}; chưa tự giữ hoặc xuất kho", [
                  line.requested_quantity ?? "0",
                  line.unit,
                ])
              : ""}
          </p>
        ))}
      </section>
      {workspace.manager && workspace.status === "handed_over" ? (
        <details>
          <summary>
            {uiText("Thêm loại dụng cụ mới phát sinh sau giao")}
          </summary>
          <FulfillmentAddedLine
            key={workspace.lines.length}
            workspace={workspace}
            disabled={locked}
            onSubmit={(body) => submit("add_supplemental_line", body)}
          />
        </details>
      ) : null}
      {uncertain ? (
        <button
          className="button"
          disabled={busy}
          onClick={() => void retryPending()}
        >
          {uiText("Đối soát thao tác chưa rõ kết quả")}
        </button>
      ) : null}
      <section>
        <h2>{uiText("Thực giao, thực trả và nghĩa vụ")}</h2>
        {workspace.issues.map((issue) => (
          <article key={issue.id}>
            <strong>
              {issue.item_name} {issue.asset_code ?? ""}
            </strong>
            <p>
              {uiText("Thực giao ")}
              {issue.issued}
              {uiText(" · Thực trả ")}
              {issue.returned}
              {uiText(" · Đã resolve")} {issue.resolved}
              {uiText(" · Còn phải trả ")}
              {issue.due}
              {uiText(" · Hold đối soát")} {issue.held}
              {uiText(" · Đơn vị kho: ")}
              {issue.base_uom_code}
            </p>
            <p>
              {issue.return_required
                ? uiText("Có nghĩa vụ hoàn trả")
                : uiText(
                    "Không phải trả vật tư; vẫn phải ký xác nhận trả lần đầu",
                  )}{" "}
              {uiText("· Mã phần thực giao: ")}
              {issue.id}
            </p>
          </article>
        ))}
      </section>
      {workspace.manager ? (
        <section>
          <h2>{uiText("Ghi nhận sự kiện")}</h2>
          <fieldset disabled={locked}>
            <label>
              {uiText("Thao tác")}
              <select
                value={operation}
                onChange={(event) => {
                  setOperation(event.target.value as FulfillmentOperation);
                  setRows([]);
                  setConfirmed(false);
                }}
              >
                {(
                  Object.entries(fulfillmentLabels) as [
                    FulfillmentOperation,
                    string,
                  ][]
                )
                  .filter(
                    ([key]) =>
                      key !== "sign" &&
                      key !== "add_supplemental_line" &&
                      (key === "correct" ||
                        (workspace.status === "preparing"
                          ? key === "handover"
                          : workspace.status === "handed_over"
                            ? ["supplement", "initial_return"].includes(key)
                            : [
                                "recover",
                                "resolve",
                                "consequence",
                                "reconcile",
                              ].includes(key))) &&
                      (workspace.admin ||
                        !["consequence", "reconcile"].includes(key)),
                  )
                  .map(([key, label]) => (
                    <option key={key} value={key}>
                      {uiText(label)}
                    </option>
                  ))}
              </select>
            </label>
            {operation === "correct" ? (
              <label>
                {uiText("Sự kiện cần đính chính (trang lịch sử hiện tại)")}
                <select
                  value={correction}
                  onChange={(event) => {
                    setCorrection(event.target.value);
                    setRows([]);
                  }}
                >
                  <option value="">{uiText("Chọn sự kiện")}</option>
                  {workspace.events
                    .filter((event) => !event.superseded)
                    .map((event) => (
                      <option key={event.id} value={event.id}>
                        #{event.revision} {event.operation} — {event.reason}
                      </option>
                    ))}
                </select>
              </label>
            ) : null}
            <p>
              {operation === "correct"
                ? uiText(
                    "Nhập toàn bộ nội dung thay thế đúng. Bản cũ và chữ ký cũ luôn được giữ; bản thay thế cần ký riêng nếu thuộc lần giao/trả phải ký.",
                  )
                : effectiveOperation === "recover"
                  ? uiText(
                      "Nhập số thực nhận của LẦN NÀY theo từng tình trạng. Hệ thống cộng vào lịch sử; trả muộn tự đối trừ phần đã xử lý không thu hồi.",
                    )
                  : uiText(
                      "Chỉ xác nhận hàng đã thực giao/thực nhận. Không dùng thay cho kế hoạch.",
                    )}
            </p>
            {issuing ? (
              <>
                <label>
                  {uiText("Dòng yêu cầu")}
                  <select
                    value={lineId}
                    onChange={(event) => {
                      setLineId(event.target.value);
                      setSources([]);
                      setSourceIndex(-1);
                    }}
                  >
                    {workspace.lines.map((line) => (
                      <option key={line.id} value={line.id}>
                        {line.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="button button-secondary"
                  onClick={() => void loadSources()}
                >
                  {uiText("Tải nguồn giao")}
                </button>
                <label>
                  {uiText("Nguồn và mapping")}
                  <select
                    value={sourceIndex}
                    onChange={(event) => {
                      setSourceIndex(Number(event.target.value));
                      setAssets([]);
                      setAssetIds([]);
                    }}
                  >
                    <option value={-1}>{uiText("Chọn nguồn")}</option>
                    {sources.map((source, index) => (
                      <option
                        key={`${source.mapping_id}:${source.location_id}`}
                        value={index}
                      >
                        {source.item_name} — {source.location_name}
                        {uiText(" — khả dụng")} {source.available_quantity}{" "}
                        {source.base_uom_code}
                        {uiText("; quy đổi ")}
                        {source.conversion_factor}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="button button-secondary"
                  disabled={sourcePage <= 1}
                  onClick={() => void loadSources(sourcePage - 1)}
                >
                  {uiText("Nguồn trước")}
                </button>{" "}
                <button
                  className="button button-secondary"
                  disabled={sources.length < 100}
                  onClick={() => void loadSources(sourcePage + 1)}
                >
                  {uiText("Nguồn tiếp")}
                </button>
                {selectedSource?.tracking_strategy === "serialized" ? (
                  <>
                    <button
                      className="button button-secondary"
                      onClick={() => void loadAssets()}
                    >
                      {uiText("Chọn tài sản chính xác")}
                    </button>
                    {assets.map((asset) => (
                      <label key={asset.id}>
                        <input
                          type="checkbox"
                          checked={assetIds.includes(asset.id)}
                          disabled={!asset.eligible}
                          onChange={(event) =>
                            setAssetIds((current) =>
                              event.target.checked
                                ? [...current, asset.id]
                                : current.filter((id) => id !== asset.id),
                            )
                          }
                        />
                        {asset.asset_code}{" "}
                        {asset.unreserved
                          ? ""
                          : uiText(
                              "(đang có reservation; máy chủ kiểm tra chủ phiếu)",
                            )}
                      </label>
                    ))}
                    <button
                      className="button button-secondary"
                      disabled={assetPage <= 1}
                      onClick={() => void loadAssets(assetPage - 1)}
                    >
                      {uiText("Tài sản trước")}
                    </button>{" "}
                    <button
                      className="button button-secondary"
                      disabled={assetPage * 100 >= assetTotal}
                      onClick={() => void loadAssets(assetPage + 1)}
                    >
                      {uiText("Tài sản tiếp")}
                    </button>
                    <p>
                      {uiText("Đã chọn ")}
                      {assetIds.length}
                      {uiText(" tài sản.")}
                    </p>
                  </>
                ) : null}
              </>
            ) : (
              <>
                <label>
                  {uiText("Phần thực giao")}
                  <select
                    value={selectedIssue?.id ?? ""}
                    onChange={(event) => setSliceId(event.target.value)}
                  >
                    <option value="">{uiText("Chọn phần thực giao")}</option>
                    {selectableIssues.map((issue) => (
                      <option key={issue.id} value={issue.id}>
                        {issue.item_name} {issue.asset_code ?? issue.id}
                        {uiText(" — còn")} {issue.due}
                        {uiText(", resolve ")}
                        {issue.resolved}
                        {uiText(", hold ")}
                        {issue.held}
                      </option>
                    ))}
                  </select>
                </label>
                {receiving ? (
                  <>
                    <label>
                      {uiText("Nơi thực nhận")}
                      <select
                        value={locationId}
                        onChange={(event) => setLocationId(event.target.value)}
                      >
                        {workspace.locations.map((location) => (
                          <option key={location.id} value={location.id}>
                            {location.name}
                            {location.active
                              ? ""
                              : uiText(" (ngừng hoạt động)")}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      {uiText("Tình trạng")}
                      <select
                        value={condition}
                        onChange={(event) => setCondition(event.target.value)}
                      >
                        <option value="good">{uiText("Tốt")}</option>
                        <option value="damaged">{uiText("Hư hỏng")}</option>
                      </select>
                    </label>
                  </>
                ) : (
                  <label>
                    {uiText("Phân loại")}
                    <select
                      value={classification}
                      onChange={(event) =>
                        setClassification(event.target.value)
                      }
                    >
                      <option value="">{uiText("Chọn phân loại")}</option>
                      {(effectiveOperation === "consequence"
                        ? ["settled", "retired", "disposed"]
                        : effectiveOperation === "reconcile"
                          ? ["restore_eligible", "retain_ineligible"]
                          : ["missing", "unrecoverable", "waived"]
                      ).map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </>
            )}
            <label>
              {receiving && operation !== "correct"
                ? uiText("Số thực nhận lần này (đơn vị kho)")
                : uiText("Số lượng thực tế (base unit)")}
              <input
                inputMode="decimal"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
              />
            </label>
            {!administrative ? (
              <>
                <button className="button button-secondary" onClick={addRow}>
                  {uiText("Thêm dòng sự kiện")}
                </button>
                {rows.map((row, index) => (
                  <p key={index}>
                    {issuing
                      ? uiText("{0}: thực giao {1}", [
                          workspace.lines.find(
                            (line) => line.id === row.line_id,
                          )?.name ?? uiText("Dụng cụ"),
                          row.quantity,
                        ])
                      : `${workspace.issues.find((issue) => issue.id === row.issue_slice_id)?.item_name ?? uiText("Dụng cụ")}: ${receiving ? uiText("nhận lần này") : uiText("xử lý")} ${row.quantity} · ${row.condition === "good" ? uiText("tốt") : row.condition === "damaged" ? uiText("hỏng") : (row.classification ?? "")}`}{" "}
                    <button
                      className="button button-secondary"
                      onClick={() =>
                        setRows((current) =>
                          current.filter((_, i) => i !== index),
                        )
                      }
                    >
                      {uiText("Bỏ dòng ")}
                      {index + 1}
                    </button>
                  </p>
                ))}
                {effectiveOperation === "initial_return" ? (
                  <p>
                    {uiText(
                      "Với consumable-only hoặc chưa nhận lại hàng: xác nhận lần trả đầu với danh sách rỗng vẫn hợp lệ; chữ ký trả vẫn bắt buộc.",
                    )}
                  </p>
                ) : null}
              </>
            ) : (
              <label>
                {uiText("Bằng chứng đối soát")}
                <textarea
                  value={evidence}
                  onChange={(event) => setEvidence(event.target.value)}
                />
              </label>
            )}
            {receiving && operation !== "correct" ? (
              <FulfillmentReturnPreview workspace={workspace} rows={rows} />
            ) : null}
            <label>
              {uiText("Lý do")}
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
            {receiving && operation !== "correct" ? (
              <label>
                {uiText(
                  "Người mang trả (người đăng ký hoặc trợ giảng; không thay quyền ký)",
                )}
                <input
                  maxLength={200}
                  value={carrierName}
                  onChange={(event) => setCarrierName(event.target.value)}
                />
              </label>
            ) : null}
            <label>
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              {uiText(
                "Tôi xác nhận đây là sự kiện thực tế / quyết định có căn cứ, không phải dự kiến.",
              )}
            </label>
            <button
              className="button"
              disabled={!confirmed || !reason.trim()}
              onClick={post}
            >
              {uiText("Ghi nhận ")}
              {uiText(fulfillmentLabels[operation])}
            </button>
          </fieldset>
        </section>
      ) : null}
      <section>
        <h2>{uiText("Lịch sử bất biến và chữ ký")}</h2>
        {workspace.events.map((event) => (
          <article key={event.id}>
            <h3>
              #{event.revision}{" "}
              {uiText(
                fulfillmentLabels[event.operation as FulfillmentOperation] ??
                  event.operation,
              )}
            </h3>
            <p>
              {dateTime.format(new Date(event.occurred_at))} — {event.reason}
            </p>
            <p>
              {event.superseded
                ? uiText("Đã có bản đính chính; giữ nguyên bằng chứng này.")
                : event.signature_required
                  ? event.signature
                    ? uiText("Đã ký {0}", [
                        dateTime.format(new Date(event.signature.signed_at)),
                      ])
                    : uiText("Đang chờ chữ ký")
                  : uiText("Không cần ký lại")}
            </p>
            <FulfillmentEventEvidence event={event} />
            <details>
              <summary>{uiText("Chi tiết kỹ thuật snapshot")}</summary>
              <pre style={{ whiteSpace: "pre-wrap" }}>
                {JSON.stringify(event.snapshot, null, 2)}
              </pre>
            </details>
            {workspace.signer &&
            event.signature_required &&
            !event.signature &&
            !event.superseded ? (
              <button
                className="button"
                disabled={locked}
                onClick={() => {
                  setSigningId(event.id);
                  setSignature("");
                  hasInk.current = false;
                }}
              >
                {uiText("Ký sự kiện #")}
                {event.revision}
              </button>
            ) : null}
          </article>
        ))}
        <button
          className="button button-secondary"
          disabled={busy || page <= 1}
          onClick={() => void refresh(page - 1)}
        >
          {uiText("Lịch sử trước")}
        </button>{" "}
        <button
          className="button button-secondary"
          disabled={busy || page * 50 >= workspace.event_count}
          onClick={() => void refresh(page + 1)}
        >
          {uiText("Lịch sử tiếp")}
        </button>
      </section>
      {signEvent ? (
        <section>
          <h2>
            {uiText("Ký đúng sự kiện #")}
            {signEvent.revision}
          </h2>
          <p>
            {signEvent.reason}
            {uiText(
              ". Chữ ký xác nhận nội dung snapshot bên trên, không ghi kho thêm.",
            )}
          </p>
          <FulfillmentEventEvidence event={signEvent} />
          <canvas
            key={signingId}
            ref={canvasRef}
            width={600}
            height={180}
            aria-label={uiText(
              "Vùng vẽ chữ ký; có thể tải ảnh PNG thay thế bên dưới",
            )}
            style={{
              border: "1px solid var(--ink-600)",
              width: "100%",
              maxWidth: 600,
              touchAction: "none",
            }}
            onPointerDown={(event) => {
              if (locked) return;
              drawing.current = true;
              event.currentTarget.setPointerCapture(event.pointerId);
              const rect = event.currentTarget.getBoundingClientRect();
              const ctx = event.currentTarget.getContext("2d");
              ctx?.beginPath();
              ctx?.moveTo(
                ((event.clientX - rect.left) * 600) / rect.width,
                ((event.clientY - rect.top) * 180) / rect.height,
              );
            }}
            onPointerMove={(event) => {
              if (!drawing.current || locked) return;
              const rect = event.currentTarget.getBoundingClientRect();
              const ctx = event.currentTarget.getContext("2d");
              if (ctx) {
                ctx.lineWidth = 2;
                ctx.lineCap = "round";
                ctx.lineTo(
                  ((event.clientX - rect.left) * 600) / rect.width,
                  ((event.clientY - rect.top) * 180) / rect.height,
                );
                ctx.stroke();
                hasInk.current = true;
              }
            }}
            onPointerUp={(event) => {
              if (drawing.current && hasInk.current)
                setSignature(event.currentTarget.toDataURL("image/png"));
              drawing.current = false;
            }}
            onPointerCancel={() => {
              drawing.current = false;
            }}
          />
          <label>
            {uiText("Hoặc tải ảnh chữ ký PNG")}
            <input
              type="file"
              accept="image/png"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                if (file.type !== "image/png" || file.size > 290000) {
                  setMessage("Chọn PNG tối đa 290 KB.");
                  return;
                }
                const reader = new FileReader();
                reader.onload = () => setSignature(String(reader.result));
                reader.readAsDataURL(file);
              }}
            />
          </label>
          <button
            className="button button-secondary"
            disabled={locked}
            onClick={() => {
              canvasRef.current?.getContext("2d")?.clearRect(0, 0, 600, 180);
              hasInk.current = false;
              setSignature("");
            }}
          >
            {uiText("Ký lại")}
          </button>{" "}
          <button
            className="button"
            disabled={locked || !signature}
            onClick={() =>
              void submit("sign", {
                event_id: signEvent.id,
                snapshot_hash: signEvent.snapshot_hash,
                signature,
              })
            }
          >
            {uiText("Xác nhận chữ ký sự kiện #")}
            {signEvent.revision}
          </button>{" "}
          <button
            className="button button-secondary"
            disabled={locked}
            onClick={() => setSigningId("")}
          >
            {uiText("Đóng ký")}
          </button>
        </section>
      ) : null}
    </div>
  );
}
