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
import styles from "./equipment-preparation.module.css";

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
  const [workspace, setWorkspace] = useState(initial);
  const [operation, setOperation] = useState<FulfillmentOperation>(
    initial.status === "preparing" ? "handover" : "initial_return",
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
      pending.current = null;
      setUncertain(false);
      setRows([]);
      setReason("");
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
    if (!/^\d+(\.\d{1,6})?$/.test(quantity)) {
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
      if (!sliceId) {
        setMessage("Chọn phần thực giao cần xử lý.");
        return;
      }
      setRows((current) => [
        ...current,
        {
          issue_slice_id: sliceId,
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
        <Link href="/equipment/requests">Danh sách phiếu</Link> ·{" "}
        <Link href={`/equipment/preparation/${workspace.request_id}`}>
          Chuẩn bị
        </Link>
      </p>
      <p>
        Trạng thái: <strong>{workspace.status}</strong> · Phiên bản{" "}
        {workspace.revision}. Chữ ký không tạo thêm xuất/nhập kho.
      </p>
      <button
        className="button button-secondary"
        disabled={busy}
        onClick={() => void refresh()}
      >
        Tải phiên bản mới
      </button>
      <p role="status">{message}</p>
      <section>
        <h2>Đăng ký và kế hoạch</h2>
        {workspace.lines.map((line) => (
          <p key={line.id}>
            {line.name}: đăng ký {line.registered_quantity}, planned{" "}
            {line.planned_quantity} {line.unit}
          </p>
        ))}
      </section>
      {uncertain ? (
        <button
          className="button"
          disabled={busy}
          onClick={() => void retryPending()}
        >
          Đối soát thao tác chưa rõ kết quả
        </button>
      ) : null}
      <section>
        <h2>Thực giao, thực trả và nghĩa vụ</h2>
        {workspace.issues.map((issue) => (
          <article key={issue.id}>
            <strong>
              {issue.item_name} {issue.asset_code ?? ""}
            </strong>
            <p>
              Thực giao {issue.issued} · Thực trả {issue.returned} · Đã resolve{" "}
              {issue.resolved} · Còn phải trả {issue.due} · Hold đối soát{" "}
              {issue.held}
            </p>
            <p>
              {issue.return_required
                ? "Có nghĩa vụ hoàn trả"
                : "Không phải trả vật tư; vẫn phải ký xác nhận trả lần đầu"}{" "}
              · Mã phần thực giao: {issue.id}
            </p>
          </article>
        ))}
      </section>
      {workspace.manager ? (
        <section>
          <h2>Ghi nhận sự kiện</h2>
          <fieldset disabled={locked}>
            <label>
              Thao tác
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
                      (workspace.admin ||
                        !["consequence", "reconcile"].includes(key)),
                  )
                  .map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
              </select>
            </label>
            {operation === "correct" ? (
              <label>
                Sự kiện cần đính chính (trang lịch sử hiện tại)
                <select
                  value={correction}
                  onChange={(event) => {
                    setCorrection(event.target.value);
                    setRows([]);
                  }}
                >
                  <option value="">Chọn sự kiện</option>
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
                ? "Nhập toàn bộ nội dung thay thế đúng. Bản cũ và chữ ký cũ luôn được giữ; bản thay thế cần ký riêng nếu thuộc lần giao/trả phải ký."
                : effectiveOperation === "recover"
                  ? "Nhập TỔNG đã thực nhận của phần giao theo từng tình trạng; máy chủ chỉ ghi phần tăng. Trả muộn tự offset resolution liên quan."
                  : "Chỉ xác nhận hàng đã thực giao/thực nhận. Không dùng thay cho kế hoạch."}
            </p>
            {issuing ? (
              <>
                <label>
                  Dòng yêu cầu
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
                  Tải nguồn giao
                </button>
                <label>
                  Nguồn và mapping
                  <select
                    value={sourceIndex}
                    onChange={(event) => {
                      setSourceIndex(Number(event.target.value));
                      setAssets([]);
                      setAssetIds([]);
                    }}
                  >
                    <option value={-1}>Chọn nguồn</option>
                    {sources.map((source, index) => (
                      <option
                        key={`${source.mapping_id}:${source.location_id}`}
                        value={index}
                      >
                        {source.item_name} — {source.location_name} — khả dụng{" "}
                        {source.available_quantity} {source.base_uom_code}; quy
                        đổi {source.conversion_factor}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="button button-secondary"
                  disabled={sourcePage <= 1}
                  onClick={() => void loadSources(sourcePage - 1)}
                >
                  Nguồn trước
                </button>{" "}
                <button
                  className="button button-secondary"
                  disabled={sources.length < 100}
                  onClick={() => void loadSources(sourcePage + 1)}
                >
                  Nguồn tiếp
                </button>
                {selectedSource?.tracking_strategy === "serialized" ? (
                  <>
                    <button
                      className="button button-secondary"
                      onClick={() => void loadAssets()}
                    >
                      Chọn tài sản chính xác
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
                          : "(đang có reservation; máy chủ kiểm tra chủ phiếu)"}
                      </label>
                    ))}
                    <button
                      className="button button-secondary"
                      disabled={assetPage <= 1}
                      onClick={() => void loadAssets(assetPage - 1)}
                    >
                      Tài sản trước
                    </button>{" "}
                    <button
                      className="button button-secondary"
                      disabled={assetPage * 100 >= assetTotal}
                      onClick={() => void loadAssets(assetPage + 1)}
                    >
                      Tài sản tiếp
                    </button>
                    <p>Đã chọn {assetIds.length} tài sản.</p>
                  </>
                ) : null}
              </>
            ) : (
              <>
                <label>
                  Phần thực giao
                  <select
                    value={sliceId}
                    onChange={(event) => setSliceId(event.target.value)}
                  >
                    <option value="">Chọn phần thực giao</option>
                    {workspace.issues.map((issue) => (
                      <option key={issue.id} value={issue.id}>
                        {issue.item_name} {issue.asset_code ?? issue.id} — còn{" "}
                        {issue.due}, resolve {issue.resolved}, hold {issue.held}
                      </option>
                    ))}
                  </select>
                </label>
                {receiving ? (
                  <>
                    <label>
                      Nơi thực nhận
                      <select
                        value={locationId}
                        onChange={(event) => setLocationId(event.target.value)}
                      >
                        {workspace.locations.map((location) => (
                          <option key={location.id} value={location.id}>
                            {location.name}
                            {location.active ? "" : " (ngừng hoạt động)"}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Tình trạng
                      <select
                        value={condition}
                        onChange={(event) => setCondition(event.target.value)}
                      >
                        <option value="good">Tốt</option>
                        <option value="damaged">Hư hỏng</option>
                      </select>
                    </label>
                  </>
                ) : (
                  <label>
                    Phân loại
                    <select
                      value={classification}
                      onChange={(event) =>
                        setClassification(event.target.value)
                      }
                    >
                      <option value="">Chọn phân loại</option>
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
              {effectiveOperation === "recover" && operation !== "correct"
                ? "Tổng đã thực nhận theo tình trạng (base unit)"
                : "Số lượng thực tế (base unit)"}
              <input
                inputMode="decimal"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
              />
            </label>
            {!administrative ? (
              <>
                <button className="button button-secondary" onClick={addRow}>
                  Thêm dòng sự kiện
                </button>
                {rows.map((row, index) => (
                  <p key={index}>
                    {JSON.stringify(row)}{" "}
                    <button
                      className="button button-secondary"
                      onClick={() =>
                        setRows((current) =>
                          current.filter((_, i) => i !== index),
                        )
                      }
                    >
                      Bỏ dòng {index + 1}
                    </button>
                  </p>
                ))}
                {effectiveOperation === "initial_return" ? (
                  <p>
                    Với consumable-only hoặc chưa nhận lại hàng: xác nhận lần
                    trả đầu với danh sách rỗng vẫn hợp lệ; chữ ký trả vẫn bắt
                    buộc.
                  </p>
                ) : null}
              </>
            ) : (
              <label>
                Bằng chứng đối soát
                <textarea
                  value={evidence}
                  onChange={(event) => setEvidence(event.target.value)}
                />
              </label>
            )}
            <label>
              Lý do
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              Tôi xác nhận đây là sự kiện thực tế / quyết định có căn cứ, không
              phải dự kiến.
            </label>
            <button
              className="button"
              disabled={!confirmed || !reason.trim()}
              onClick={post}
            >
              Ghi nhận {fulfillmentLabels[operation]}
            </button>
          </fieldset>
        </section>
      ) : null}
      <section>
        <h2>Lịch sử bất biến và chữ ký</h2>
        {workspace.events.map((event) => (
          <article key={event.id}>
            <h3>
              #{event.revision}{" "}
              {fulfillmentLabels[event.operation as FulfillmentOperation] ??
                event.operation}
            </h3>
            <p>
              {dateTime.format(new Date(event.occurred_at))} — {event.reason}
            </p>
            <p>
              {event.superseded
                ? "Đã có bản đính chính; giữ nguyên bằng chứng này."
                : event.signature_required
                  ? event.signature
                    ? `Đã ký ${dateTime.format(new Date(event.signature.signed_at))}`
                    : "Đang chờ chữ ký"
                  : "Không cần ký lại"}
            </p>
            <details>
              <summary>Nội dung sự kiện và hiệu lực</summary>
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
                Ký sự kiện #{event.revision}
              </button>
            ) : null}
          </article>
        ))}
        <button
          className="button button-secondary"
          disabled={busy || page <= 1}
          onClick={() => void refresh(page - 1)}
        >
          Lịch sử trước
        </button>{" "}
        <button
          className="button button-secondary"
          disabled={busy || page * 50 >= workspace.event_count}
          onClick={() => void refresh(page + 1)}
        >
          Lịch sử tiếp
        </button>
      </section>
      {signEvent ? (
        <section>
          <h2>Ký đúng sự kiện #{signEvent.revision}</h2>
          <p>
            {signEvent.reason}. Chữ ký xác nhận nội dung snapshot bên trên,
            không ghi kho thêm.
          </p>
          <canvas
            key={signingId}
            ref={canvasRef}
            width={600}
            height={180}
            aria-label="Vùng vẽ chữ ký; có thể tải ảnh PNG thay thế bên dưới"
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
            Hoặc tải ảnh chữ ký PNG
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
            Ký lại
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
            Xác nhận chữ ký sự kiện #{signEvent.revision}
          </button>{" "}
          <button
            className="button button-secondary"
            disabled={locked}
            onClick={() => setSigningId("")}
          >
            Đóng ký
          </button>
        </section>
      ) : null}
    </div>
  );
}
