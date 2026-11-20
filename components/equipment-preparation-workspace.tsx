"use client";

import { Fragment, useEffect, useEffectEvent, useRef, useState } from "react";
import Link from "next/link";
import {
  changePreparation,
  readPreparation,
} from "@/app/equipment/preparation/actions";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { PreparationAllocations } from "@/components/equipment-preparation-allocations";
import { PreparationAddedLine } from "@/components/equipment-preparation-added-line";
import { EquipmentPreparationTransfers } from "@/components/equipment-preparation-transfers";
import type {
  PreparationAddedTarget,
  PreparationDemand,
  QuantityAdjustment,
} from "@/lib/equipment-preparation";
import {
  preparationHistorySchema,
  preparationPlan,
  preparationWorkspaceSchema,
  type PreparationHistory,
  type PreparationOperation,
  type PreparationPlan,
  type PreparationPlanLine,
  type PreparationWorkspace,
} from "@/lib/equipment-preparation";
import type { Json } from "@/lib/database.types";
import type { FulfillmentSummary } from "@/lib/equipment-fulfillment";
import styles from "./equipment-preparation.module.css";
import { useLanguage } from "@/components/i18n/language-provider";
import { LocalizedText } from "@/components/i18n/language-provider";

const dateTime = new Intl.DateTimeFormat("vi-VN", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Asia/Ho_Chi_Minh",
});

export function EquipmentPreparationWorkspace({
  initial,
  summary,
}: {
  initial: PreparationWorkspace;
  summary?: FulfillmentSummary;
}) {
  const { text: uiText } = useLanguage();

  const [workspace, setWorkspace] = useState(initial);
  const [plan, setPlan] = useState<PreparationPlan>(() =>
    preparationPlan(initial),
  );
  const [owned, setOwned] = useState(false);
  const [lockToken, setLockToken] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const lockReleased = useRef(false);
  const leaseExpiry = useRef(0);
  const lastActivity = useRef(0);
  const pending = useRef<{
    signature: string;
    key: string;
    operation: PreparationOperation;
    payload: Record<string, Json>;
  } | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [commandBusy, setBusy] = useState(false);
  const [transferBusy, setTransferBusy] = useState(false);
  const busy = commandBusy || transferBusy;
  const [message, setMessage] = useState("");
  const [reason, setReason] = useState("");
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [addedTargets, setAddedTargets] = useState<PreparationAddedTarget[]>(
    [],
  );
  const requestId = workspace.request.id;
  const [history, setHistory] = useState<PreparationHistory | null>(null);
  const [prepFilter, setPrepFilter] = useState<"all" | "todo" | "short">("all");
  const [prepQuery, setPrepQuery] = useState("");
  const [openLine, setOpenLine] = useState("");
  const [confirming, setConfirming] = useState<"confirm" | "reverse" | null>(
    null,
  );
  const [sideTab, setSideTab] = useState<"summary" | "history">("summary");
  const attempt = workspace.preparation;
  const prepared = attempt?.state === "prepared";
  const editable =
    workspace.manager &&
    !busy &&
    !uncertain &&
    (prepared || (attempt?.state === "draft" && owned));
  const activities = [
    ...new Set(workspace.lines.map((line) => line.skill_name)),
  ];
  const pendingLines: PreparationDemand[] = [];
  for (const adjustment of workspace.adjustments) {
    if (adjustment.status !== "pending") continue;
    for (const target of adjustment.targets) {
      if (
        !("catalog_item_id" in target) ||
        !plan.lines.some((line) => line.line_id === target.line_id) ||
        workspace.lines.some((line) => line.id === target.line_id)
      )
        continue;
      pendingLines.push({
        id: target.line_id,
        catalog_item_id: target.catalog_item_id,
        skill_name: target.skill_name,
        demand_quantity: target.quantity,
        registered_quantity: "0",
        planned_quantity: "0",
        baseline_source: "pending_addition",
        line_revision: 1,
        note: target.note,
        commercial_name: target.commercial_name,
        item_name: target.item_name,
        unit: target.unit,
      });
    }
  }
  function reviewAdjustment(adjustment: QuantityAdjustment) {
    setPlan((current) => {
      const next = current.lines.map((line) => {
        const target = adjustment.targets.find(
          (entry) => entry.line_id === line.line_id,
        );
        return target
          ? {
              ...line,
              planned_quantity: target.quantity,
              reviewed_revision: null,
              shortage_reason: adjustment.reason,
              allocations: target.quantity === "0" ? [] : line.allocations,
            }
          : line;
      });
      for (const target of adjustment.targets) {
        if (!next.some((line) => line.line_id === target.line_id))
          next.push({
            line_id: target.line_id,
            planned_quantity: target.quantity,
            reviewed_revision: null,
            shortage_reason: adjustment.reason,
            allocations: [],
          });
      }
      return { lines: next };
    });
  }

  function reconcile(next: PreparationWorkspace, preserve: boolean) {
    setWorkspace(next);
    setPlan((current) => {
      if (!preserve) return preparationPlan(next);
      const existing = new Map(
        current.lines.map((line) => [line.line_id, line]),
      );
      return {
        lines: preparationPlan(next).lines.map(
          (line) => existing.get(line.line_id) ?? line,
        ),
      };
    });
  }
  async function refresh() {
    if (uncertain && pending.current) {
      await command(pending.current.operation, pending.current.payload);
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const result = await readPreparation(requestId);
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      reconcile(preparationWorkspaceSchema.parse(result.data), true);
      setMessage(
        "Đã tải phiên bản mới. Nội dung đang nhập được giữ; rà soát lại các dòng thay đổi.",
      );
    } catch {
      setMessage(
        "Không tải được phiên bản mới. Nội dung đang nhập được giữ nguyên.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function command(
    operation: PreparationOperation,
    payload: Record<string, Json> = {},
  ) {
    if (busy) return false;
    const body = { expected_revision: workspace.request.revision, ...payload };
    const signature = JSON.stringify([operation, body]);
    if (uncertain && signature !== pending.current?.signature) {
      setMessage(
        "Cần đối soát thao tác chưa rõ kết quả trước khi ghi nội dung mới.",
      );
      return false;
    }
    setBusy(true);
    setMessage("");
    if (pending.current?.signature !== signature)
      pending.current = {
        signature,
        key: crypto.randomUUID(),
        operation,
        payload: body,
      };
    try {
      const result = await changePreparation(
        requestId,
        operation,
        body,
        pending.current.key,
      );
      if (!result.ok) {
        setMessage(result.error);
        setUncertain(
          (previous) =>
            previous || result.committed === true || result.uncertain === true,
        );
        if (operation === "save") setSaveFailed(true);
        return false;
      }
      pending.current = null;
      setUncertain(false);
      reconcile(
        result.data,
        [
          "map_item",
          "add_line",
          "override_lock",
          "propose_adjustment",
          "reject_adjustment",
        ].includes(operation) ||
          (operation === "start" && dirty),
      );
      if (
        ["save", "confirm", "approve_adjustment", "reallocate"].includes(
          operation,
        )
      ) {
        setDirty(false);
        setSaveFailed(false);
      }
      if (result.data.preparation?.lock_expires_at)
        leaseExpiry.current = new Date(
          result.data.preparation.lock_expires_at,
        ).getTime();
      if (operation === "start") {
        lockReleased.current = false;
        setOwned(true);
      }
      if (
        [
          "release_lock",
          "confirm",
          "override_lock",
          "begin_reversal",
          "finalize_reversal",
        ].includes(operation)
      ) {
        lockReleased.current = true;
        setOwned(false);
      }
      setMessage(
        operation === "save"
          ? "Đã lưu tiến độ; chưa giữ tồn và không gửi thông báo."
          : "Đã ghi nhận thao tác.",
      );
      return true;
    } catch {
      setUncertain(true);
      setMessage(
        "Kết nối gián đoạn. Nội dung được giữ; thử lại dùng cùng mã chống ghi trùng.",
      );
      if (operation === "save") setSaveFailed(true);
      return false;
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!owned || !lockToken || attempt?.state !== "draft") return;
    lastActivity.current = Date.now();
    function activity() {
      lastActivity.current = Date.now();
    }
    window.addEventListener("pointerdown", activity, { passive: true });
    window.addEventListener("keydown", activity);
    const heartbeat = window.setInterval(() => {
      if (Date.now() >= leaseExpiry.current) {
        setOwned(false);
        setMessage(
          "Khóa đã hết hạn do không hoạt động. Nội dung đang nhập được giữ; bắt đầu lại để tiếp tục.",
        );
        return;
      }
      if (Date.now() - lastActivity.current > 30_000) return;
      void changePreparation(
        requestId,
        "heartbeat",
        { lock_token: lockToken },
        crypto.randomUUID(),
      )
        .then((result) => {
          if (!result.ok) {
            setOwned(false);
            setMessage(result.error);
          } else if (result.data.preparation?.lock_expires_at)
            leaseExpiry.current = new Date(
              result.data.preparation.lock_expires_at,
            ).getTime();
        })
        .catch(() =>
          setMessage(
            "Không gia hạn được khóa. Tiến độ đang nhập vẫn được giữ; kết nối lại trước khi lưu.",
          ),
        );
    }, 20_000);
    function release() {
      if (lockReleased.current) return;
      navigator.sendBeacon(
        "/api/equipment/preparation/release",
        new Blob(
          [
            JSON.stringify({
              request_id: requestId,
              lock_token: lockToken,
              retry_key: crypto.randomUUID(),
            }),
          ],
          { type: "application/json" },
        ),
      );
    }
    window.addEventListener("pagehide", release);
    return () => {
      window.clearInterval(heartbeat);
      window.removeEventListener("pagehide", release);
      window.removeEventListener("pointerdown", activity);
      window.removeEventListener("keydown", activity);
      release();
    };
  }, [owned, attempt?.state, requestId, lockToken]);

  const autosave = useEffectEvent(() => {
    if (attempt)
      void command("save", {
        lock_token: lockToken,
        draft_revision: attempt.revision,
        plan,
      });
  });
  useEffect(() => {
    if (!owned || busy || !dirty || saveFailed || attempt?.state !== "draft")
      return;
    const timer = window.setTimeout(() => autosave(), 1000);
    return () => window.clearTimeout(timer);
  }, [plan, owned, busy, dirty, saveFailed, attempt?.state]);

  function updateLine(id: string, patch: Partial<PreparationPlanLine>) {
    setDirty(true);
    setSaveFailed(false);
    setPlan((current) => ({
      lines: current.lines.map((line) =>
        line.line_id === id ? { ...line, ...patch } : line,
      ),
    }));
  }
  async function loadHistory(page: number) {
    setBusy(true);
    try {
      const result = await readPreparation(requestId, "history", { page });
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      setHistory(preparationHistorySchema.parse(result.data));
    } catch {
      setMessage("Không tải được lịch sử.");
    } finally {
      setBusy(false);
    }
  }
  const lockable =
    workspace.manager &&
    workspace.request.status === "new" &&
    (!attempt || ["draft", "reversed", "cancelled"].includes(attempt.state));
  const allLines = [...workspace.lines, ...pendingLines];
  const lineState = (demand: (typeof allLines)[number]) => {
    const line = plan.lines.find((row) => row.line_id === demand.id);
    const reviewed = line?.reviewed_revision === demand.line_revision;
    const short =
      Boolean(line) &&
      Number(line!.planned_quantity || 0) <
        Number(demand.registered_quantity || 0);
    return { line, reviewed, short };
  };
  const reviewedCount = allLines.filter(
    (demand) => lineState(demand).reviewed,
  ).length;
  const shortCount = allLines.filter(
    (demand) => lineState(demand).short,
  ).length;
  const prepSearch = prepQuery.trim().toLowerCase();
  const visibleDemands = allLines.filter((demand) => {
    const state = lineState(demand);
    if (!state.line) return false;
    if (prepFilter === "todo" && state.reviewed) return false;
    if (prepFilter === "short" && !state.short) return false;
    return (
      !prepSearch ||
      `${demand.skill_name} ${demand.commercial_name} ${demand.item_name}`
        .toLowerCase()
        .includes(prepSearch)
    );
  });
  const prepSteps = [
    "new",
    "preparing",
    "handed_over",
    "returned",
    "completed",
  ];
  const prepStep = prepSteps.indexOf(workspace.request.status);

  return (
    <div className={`${styles.root} kho-record`}>
      <header className="kho-record-header">
        <div className="kho-record-head">
          <div className="kho-record-title">
            <Link
              href={
                workspace.manager ? "/equipment/operations" : "/equipment/mine"
              }
            >
              ← {uiText("Công việc")}
            </Link>
            <h2>
              {uiText("Chuẩn bị · Phiếu {0}", [
                summary?.code || requestId.slice(0, 8),
              ])}
            </h2>
            <span
              className="badge"
              data-tone={prepared ? "success" : "warning"}
            >
              {prepared
                ? uiText("Đã chuẩn bị")
                : attempt?.state === "draft"
                  ? uiText("Bản nháp")
                  : attempt?.state === "reversing"
                    ? uiText("Đang đảo chuẩn bị")
                    : uiText("Chưa bắt đầu")}
            </span>
            {summary ? (
              <span className="kho-record-sub">
                {[summary.course, summary.room, summary.handover]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            ) : null}
          </div>
          <div className="kho-record-actions">
            {lockable && owned ? (
              <span className="kho-lock-chip">
                {uiText("Bạn đang giữ phiếu")}
              </span>
            ) : lockable && attempt?.lock_holder ? (
              <span className="kho-lock-chip" data-tone="busy">
                {uiText("Có người đang giữ đến {0}", [
                  dateTime.format(new Date(attempt.lock_expires_at!)),
                ])}
              </span>
            ) : null}
            {lockable && !owned ? (
              <button
                type="button"
                className="button button-primary"
                disabled={busy || uncertain}
                onClick={() => {
                  const value = lockToken ?? crypto.randomUUID();
                  setLockToken(value);
                  void command("start", { lock_token: value });
                }}
              >
                {uiText("Bắt đầu / Tiếp tục chuẩn bị")}
              </button>
            ) : null}
            {lockable && owned ? (
              <button
                type="button"
                className="button button-secondary"
                disabled={busy || uncertain}
                onClick={() =>
                  void command("release_lock", { lock_token: lockToken })
                }
              >
                {uiText("Nhả khóa tab")}
              </button>
            ) : null}
            {prepared ? (
              <Link
                className="button button-primary"
                href={`/equipment/fulfillment/${requestId}`}
              >
                {uiText("Bàn giao, thu hồi và ký xác nhận")}
              </Link>
            ) : null}
            <button
              type="button"
              className="button button-secondary"
              disabled={busy}
              onClick={() => void refresh()}
            >
              {uiText("Làm mới")}
            </button>
          </div>
        </div>
        <ol className="kho-steps" aria-label={uiText("Tiến độ phiếu")}>
          {[
            ["new", "Mới"],
            ["preparing", "Đã soạn"],
            ["handed_over", "Đã giao"],
            ["returned", "Đã trả"],
            ["completed", "Hoàn thành"],
          ].map(([value, label], index) => (
            <li
              key={value}
              data-state={
                index < prepStep
                  ? "done"
                  : index === prepStep
                    ? "current"
                    : "todo"
              }
              aria-current={index === prepStep ? "step" : undefined}
            >
              {uiText(label)}
            </li>
          ))}
        </ol>
      </header>
      {uncertain ? (
        <div role="alert">
          <p>
            {uiText(
              "Thao tác trước có thể đã ghi nhận. Nội dung và mã chống ghi trùng được giữ; cần đối soát trước khi tạo thao tác mới.",
            )}
          </p>
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() => {
              if (pending.current)
                void command(
                  pending.current.operation,
                  pending.current.payload,
                );
            }}
          >
            {uiText("Đối soát thao tác trước")}
          </button>
        </div>
      ) : null}
      {message ? (
        <p role="status" aria-live="polite" className="kho-record-message">
          <LocalizedText text={message ?? ""} />
        </p>
      ) : null}
      <div className="kho-record-grid">
        <div className="kho-record-main">
          {attempt?.health.length ? (
            <section role="alert" className="kho-card kho-card-pad kho-alert">
              <h2 className="font-semibold">{uiText("Cần phân bổ lại")}</h2>
              <p>
                {uiText(
                  "Cam kết vẫn được giữ. Nguồn đủ điều kiện không đủ cho",
                )}{" "}
                {attempt.health.length}
                {uiText(
                  " phần cam kết. Không tự giảm SL sẽ giao hoặc giải phóng tồn.",
                )}
              </p>
              {attempt.health.map((row) => (
                <p key={row.reservation_id}>
                  {uiText("Cam kết ")}
                  {row.committed}
                  {uiText("; thiếu toàn pool nguồn")} {row.pool_shortfall}
                  {uiText(" base unit.")}
                </p>
              ))}
            </section>
          ) : null}
          <fieldset disabled={uncertain} className="kho-fieldset">
            <section className="kho-card" aria-labelledby="kho-prep-lines">
              <div className="kho-card-head">
                <h3 id="kho-prep-lines">
                  {uiText("Kế hoạch chuẩn bị")}{" "}
                  <small>{uiText("· {0} dòng", [allLines.length])}</small>
                </h3>
                {prepared ? (
                  <p>
                    {uiText(
                      "Đã xác nhận chuẩn bị. Tiếp tục ghi nhận thực giao, thực nhận và ký xác nhận theo từng lần bàn giao/thu hồi.",
                    )}
                  </p>
                ) : null}
                <div className="kho-filter-bar">
                  <label className="kho-search">
                    <span className="sr-only">{uiText("Tìm thiết bị")}</span>
                    <input
                      type="search"
                      value={prepQuery}
                      placeholder={uiText("Tìm tên hoặc kỹ năng")}
                      onChange={(event) => setPrepQuery(event.target.value)}
                    />
                  </label>
                  <div className="kho-chips" aria-label={uiText("Lọc dòng")}>
                    {(
                      [
                        ["all", "Tất cả {0}", allLines.length],
                        [
                          "todo",
                          "Chưa rà {0}",
                          allLines.length - reviewedCount,
                        ],
                        ["short", "Thiếu {0}", shortCount],
                      ] as const
                    ).map(([value, label, count]) => (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={prepFilter === value}
                        onClick={() => setPrepFilter(value)}
                      >
                        {uiText(label, [count])}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="kho-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">{uiText("Thiết bị")}</th>
                      <th scope="col" className="num">
                        {uiText("Đăng ký")}
                      </th>
                      <th scope="col" className="num">
                        {uiText("Sẽ giao")}
                      </th>
                      {workspace.manager ? (
                        <>
                          <th scope="col">{uiText("Chuẩn bị")}</th>
                          <th scope="col">{uiText("Nguồn")}</th>
                          <th scope="col">{uiText("Đã rà")}</th>
                        </>
                      ) : null}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleDemands.map((demand) => {
                      const { line, reviewed, short } = lineState(demand);
                      if (!line) return null;
                      const open = openLine === demand.id;
                      const title = `${demand.skill_name} · ${demand.commercial_name || demand.item_name}`;
                      return (
                        <Fragment key={demand.id}>
                          <tr data-open={open || undefined}>
                            <th scope="row">
                              <span className="cell-stack">
                                <strong>
                                  {demand.commercial_name || demand.item_name}
                                </strong>
                                <small>
                                  {[
                                    demand.skill_name,
                                    demand.baseline_source === "added"
                                      ? uiText("Thêm sau đăng ký")
                                      : demand.baseline_source ===
                                          "pending_addition"
                                        ? uiText("Đề nghị mới, chưa giữ tồn")
                                        : demand.baseline_source ===
                                            "cutover_snapshot"
                                          ? uiText("Baseline chụp tại cutover")
                                          : "",
                                    demand.note,
                                  ]
                                    .filter(Boolean)
                                    .join(" · ")}
                                </small>
                              </span>
                            </th>
                            <td className="num">
                              {demand.registered_quantity} {demand.unit}
                            </td>
                            <td className="num">{demand.planned_quantity}</td>
                            {workspace.manager ? (
                              <>
                                <td>
                                  <label className="kho-cell-field">
                                    <span className="sr-only">
                                      {uiText("Số lượng chuẩn bị")}: {title}
                                    </span>
                                    <input
                                      inputMode="numeric"
                                      pattern="[0-9]+"
                                      aria-invalid={short || undefined}
                                      value={line.planned_quantity}
                                      disabled={!editable}
                                      onChange={(event) =>
                                        updateLine(demand.id, {
                                          planned_quantity: event.target.value,
                                        })
                                      }
                                    />
                                  </label>
                                </td>
                                <td className="kho-source-cell">
                                  {line.allocations.length ? (
                                    <span className="badge" data-tone="info">
                                      {uiText("{0} nguồn", [
                                        line.allocations.length,
                                      ])}
                                    </span>
                                  ) : (
                                    <span className="badge" data-tone="warning">
                                      {uiText("Chưa phân bổ")}
                                    </span>
                                  )}
                                  <button
                                    type="button"
                                    className="button button-secondary kho-row-toggle"
                                    aria-expanded={open}
                                    onClick={() =>
                                      setOpenLine(open ? "" : demand.id)
                                    }
                                  >
                                    {open
                                      ? uiText("Đóng")
                                      : workspace.manager
                                        ? uiText("Phân bổ")
                                        : uiText("Đề nghị")}
                                  </button>
                                </td>
                                <td>
                                  <label className="kho-cell-check">
                                    <input
                                      type="checkbox"
                                      checked={reviewed}
                                      disabled={!editable}
                                      onChange={(event) =>
                                        updateLine(demand.id, {
                                          reviewed_revision: event.target
                                            .checked
                                            ? demand.line_revision
                                            : null,
                                        })
                                      }
                                    />
                                    <span className="sr-only">
                                      {uiText("Đã rà soát dòng phiên bản ")}
                                      {demand.line_revision}: {title}
                                    </span>
                                  </label>
                                </td>
                              </>
                            ) : (
                              <td>
                                <button
                                  type="button"
                                  className="button button-secondary kho-row-toggle"
                                  aria-expanded={open}
                                  onClick={() =>
                                    setOpenLine(open ? "" : demand.id)
                                  }
                                >
                                  {open
                                    ? uiText("Đóng")
                                    : workspace.manager
                                      ? uiText("Phân bổ")
                                      : uiText("Đề nghị")}
                                </button>
                              </td>
                            )}
                          </tr>
                          {open ? (
                            <tr className="kho-row-detail">
                              <td colSpan={workspace.manager ? 6 : 4}>
                                {workspace.manager ? (
                                  <>
                                    {short ? (
                                      <label>
                                        {uiText("Lý do chuẩn bị thiếu")}
                                        <input
                                          value={line.shortage_reason}
                                          disabled={!editable}
                                          onChange={(event) =>
                                            updateLine(demand.id, {
                                              shortage_reason:
                                                event.target.value,
                                            })
                                          }
                                        />
                                      </label>
                                    ) : null}
                                    <PreparationAllocations
                                      requestId={requestId}
                                      demand={demand}
                                      planned={line.planned_quantity}
                                      allocations={line.allocations}
                                      disabled={!editable}
                                      onChange={(allocations) =>
                                        updateLine(demand.id, { allocations })
                                      }
                                      command={command}
                                    />
                                  </>
                                ) : null}
                                {workspace.can_propose ? (
                                  <label>
                                    {uiText(
                                      "SL đề nghị tuyệt đối (0 = ngừng giao dòng này)",
                                    )}
                                    <input
                                      inputMode="numeric"
                                      pattern="[0-9]+"
                                      value={targets[demand.id] ?? ""}
                                      onChange={(event) =>
                                        setTargets((current) => ({
                                          ...current,
                                          [demand.id]: event.target.value,
                                        }))
                                      }
                                      disabled={busy}
                                      placeholder={demand.planned_quantity}
                                    />
                                  </label>
                                ) : null}
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      );
                    })}
                    {visibleDemands.length ? null : (
                      <tr>
                        <td
                          colSpan={workspace.manager ? 6 : 4}
                          className="panel-empty"
                        >
                          {uiText("Không có dòng nào khớp bộ lọc.")}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {lockable && owned ? (
                <div className="kho-record-footer kho-record-footer-row">
                  <span>
                    {uiText(
                      "{0}/{1} dòng đã rà · chỉ giữ hàng khi bấm Xác nhận",
                      [reviewedCount, allLines.length],
                    )}
                  </span>
                  <div className="kho-record-actions">
                    <button
                      type="button"
                      className="button button-secondary"
                      disabled={busy}
                      onClick={() =>
                        void command("save", {
                          lock_token: lockToken,
                          draft_revision: attempt?.revision ?? 1,
                          plan,
                        })
                      }
                    >
                      {uiText("Lưu tiến độ")}
                    </button>
                    <button
                      type="button"
                      className="button"
                      disabled={busy}
                      onClick={() => setConfirming("confirm")}
                    >
                      {uiText("Xác nhận đã chuẩn bị")}
                    </button>
                    <ConfirmDialog
                      open={confirming === "confirm"}
                      tone="primary"
                      title="Xác nhận đã chuẩn bị?"
                      description="Hệ thống sẽ giữ đúng số lượng và thiết bị trong kế hoạch, rồi gửi thông báo."
                      confirmLabel="Xác nhận đã chuẩn bị"
                      pending={busy}
                      onCancel={() => setConfirming(null)}
                      onConfirm={() => {
                        setConfirming(null);
                        void command("confirm", {
                          lock_token: lockToken,
                          draft_revision: attempt?.revision ?? 1,
                          plan,
                        });
                      }}
                    />
                  </div>
                </div>
              ) : null}
            </section>
            {workspace.manager && owned && attempt?.state === "draft" ? (
              <PreparationAddedLine
                requestId={requestId}
                activities={activities}
                disabled={busy}
                title={uiText("Warehouse thêm dòng độc lập")}
                actionLabel={uiText("Thêm vào bản chuẩn bị")}
                onAdd={(target, note) =>
                  command("add_line", {
                    catalog_item_id: target.catalog_item_id,
                    skill_name: target.skill_name,
                    quantity: target.quantity,
                    note: target.note,
                    reason: note,
                    lock_token: lockToken,
                  })
                }
              />
            ) : null}
            {workspace.can_propose &&
            ["new", "preparing"].includes(workspace.request.status) ? (
              <PreparationAddedLine
                requestId={requestId}
                activities={activities}
                disabled={
                  busy ||
                  workspace.adjustments.some((row) => row.status === "pending")
                }
                title={uiText("Đề nghị thêm thiết bị")}
                actionLabel={uiText("Đưa vào đề nghị đang soạn")}
                onAdd={async (target, note) => {
                  setAddedTargets((current) => [...current, target]);
                  setReason((current) => current || note);
                  return true;
                }}
              />
            ) : null}
            {addedTargets.map((target) => (
              <p key={target.line_id}>
                {uiText("Đang soạn đề nghị: ")}
                {target.skill_name} · {target.commercial_name} ·{" "}
                {target.quantity} {target.unit}{" "}
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={busy}
                  onClick={() =>
                    setAddedTargets((current) =>
                      current.filter((row) => row.line_id !== target.line_id),
                    )
                  }
                >
                  {uiText("Bỏ khỏi bản đề nghị")}
                </button>
              </p>
            ))}
            {workspace.can_propose &&
            ["new", "preparing"].includes(workspace.request.status) ? (
              <form
                className="kho-card kho-card-pad"
                onSubmit={(event) => {
                  event.preventDefault();
                  void command("propose_adjustment", {
                    reason,
                    targets: [
                      ...Object.entries(targets)
                        .filter(([, quantity]) => quantity !== "")
                        .map(([line_id, quantity]) => ({ line_id, quantity })),
                      ...addedTargets,
                    ],
                  }).then((ok) => {
                    if (ok) {
                      setAddedTargets([]);
                      setTargets({});
                    }
                  });
                }}
              >
                <h2 className="font-semibold">
                  {uiText("Đề nghị điều chỉnh")}
                </h2>
                <p>
                  {uiText(
                    "SL đề nghị là tổng mới, không phải phần tăng thêm. Pending không đổi plan hoặc reservation.",
                  )}
                </p>
                <label>
                  {uiText("Lý do đề nghị")}
                  <textarea
                    required
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                  />
                </label>
                <button
                  type="submit"
                  className="button"
                  disabled={
                    busy ||
                    workspace.adjustments.some(
                      (row) => row.status === "pending",
                    )
                  }
                >
                  {uiText("Gửi đề nghị chờ duyệt")}
                </button>
              </form>
            ) : null}
            {workspace.adjustments.length ? (
              <section className="kho-card kho-card-pad">
                <h3>{uiText("Đề nghị gần đây")}</h3>
                {workspace.adjustments.map((adjustment) => (
                  <article key={adjustment.id} className="kho-subcard">
                    <p>
                      {adjustment.status === "pending"
                        ? uiText("Chờ duyệt")
                        : adjustment.status === "approved"
                          ? uiText("Đã duyệt")
                          : uiText("Đã từ chối")}
                      {uiText(" · Gửi tại phiên bản")}{" "}
                      {adjustment.submitted_revision} · {adjustment.reason}
                    </p>
                    {adjustment.targets.map((target) => (
                      <p key={target.line_id}>
                        {"commercial_name" in target
                          ? target.commercial_name
                          : (workspace.lines.find(
                              (line) => line.id === target.line_id,
                            )?.commercial_name ?? target.line_id)}
                        {uiText(": SL đề nghị ")}
                        {target.quantity}
                      </p>
                    ))}
                    {workspace.manager && adjustment.status === "pending" ? (
                      <>
                        <p>
                          {uiText(
                            "Đặt đúng SL đề nghị trong plan và rà soát phiên bản hiện hành trước khi duyệt.",
                          )}
                        </p>
                        <label>
                          {uiText("Lý do quyết định")}
                          <input
                            value={reason}
                            onChange={(event) => setReason(event.target.value)}
                          />
                        </label>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            className="button button-secondary"
                            disabled={busy}
                            onClick={() => reviewAdjustment(adjustment)}
                          >
                            {uiText("Đưa SL tuyệt đối vào bản đang rà soát")}
                          </button>
                          <button
                            type="button"
                            className="button"
                            disabled={busy}
                            onClick={() =>
                              void command("approve_adjustment", {
                                adjustment_id: adjustment.id,
                                reviewed_revision: workspace.request.revision,
                                plan,
                                reason,
                              })
                            }
                          >
                            {uiText("Duyệt trên phiên bản ")}
                            {workspace.request.revision}
                          </button>
                          <button
                            type="button"
                            className="button button-secondary"
                            disabled={busy || !reason.trim()}
                            onClick={() =>
                              void command("reject_adjustment", {
                                adjustment_id: adjustment.id,
                                reason,
                              })
                            }
                          >
                            {uiText("Từ chối, giữ nguyên plan")}
                          </button>
                        </div>
                      </>
                    ) : null}
                  </article>
                ))}
              </section>
            ) : null}
            {workspace.manager ? (
              <details className="kho-card kho-card-pad">
                <summary className="kho-summary-toggle">
                  {uiText(
                    "Chuyển kho vật lý trước khi giao (khi lấy hàng từ tủ khác)",
                  )}
                </summary>
                <EquipmentPreparationTransfers
                  workspace={workspace}
                  lockToken={owned ? lockToken : null}
                  disabled={commandBusy || uncertain}
                  onWorkspace={(next) => reconcile(next, true)}
                  onBusyChange={setTransferBusy}
                />
              </details>
            ) : null}
            {workspace.manager &&
            (prepared ||
              attempt?.state === "reversing" ||
              (owned &&
                attempt?.state === "draft" &&
                workspace.transfers.length > 0)) ? (
              <section className="kho-card kho-card-pad">
                <h2 className="text-lg font-semibold">
                  {uiText("Cam kết và đảo chuẩn bị")}
                </h2>
                <label>
                  {uiText("Lý do thao tác")}
                  <textarea
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  {prepared ? (
                    <button
                      type="button"
                      className="button"
                      disabled={busy || !reason.trim()}
                      onClick={() =>
                        void command("reallocate", { plan, reason })
                      }
                    >
                      {uiText("Phân bổ lại, giữ SL sẽ giao")}
                    </button>
                  ) : null}
                  {attempt?.state !== "reversing" ? (
                    <>
                      <button
                        type="button"
                        className="button button-secondary"
                        disabled={busy || !reason.trim()}
                        onClick={() => setConfirming("reverse")}
                      >
                        {uiText("Bắt đầu đảo chuẩn bị")}
                      </button>
                      <ConfirmDialog
                        open={confirming === "reverse"}
                        title="Bắt đầu đảo chuẩn bị?"
                        description="Mọi thiết bị đã chuyển kho phải được trả về nơi cũ trước khi hoàn tất."
                        confirmLabel="Bắt đầu đảo chuẩn bị"
                        pending={busy}
                        onCancel={() => setConfirming(null)}
                        onConfirm={() => {
                          setConfirming(null);
                          void command("begin_reversal", {
                            reason,
                            lock_token: lockToken,
                          });
                        }}
                      />
                    </>
                  ) : (
                    <>
                      <p>
                        {uiText(
                          "Hoàn tất mọi chuyển trả bù trừ liên quan trước khi giải phóng cam kết.",
                        )}
                      </p>
                      <button
                        type="button"
                        className="button"
                        disabled={busy || !reason.trim()}
                        onClick={() =>
                          void command("finalize_reversal", { reason })
                        }
                      >
                        {uiText("Kiểm tra và hoàn tất đảo về NEW")}
                      </button>
                    </>
                  )}
                </div>
              </section>
            ) : null}
          </fieldset>
        </div>
        <aside className="kho-record-aside">
          <div
            className="kho-side-tabs"
            role="group"
            aria-label={uiText("Bảng bên")}
          >
            <button
              type="button"
              aria-pressed={sideTab === "summary"}
              onClick={() => setSideTab("summary")}
            >
              {uiText("Tóm tắt")}
            </button>
            <button
              type="button"
              aria-pressed={sideTab === "history"}
              onClick={() => {
                setSideTab("history");
                if (!history) void loadHistory(1);
              }}
            >
              {uiText("Lịch sử")}
            </button>
          </div>
          {sideTab === "summary" ? (
            <>
              <dl className="kho-summary">
                <dt>{uiText("Người đăng ký")}</dt>
                <dd>{summary?.registrant || "—"}</dd>
                <dt>{uiText("GV phụ trách")}</dt>
                <dd>{summary?.responsible || "—"}</dd>
                <dt>{uiText("Buổi học")}</dt>
                <dd>
                  {summary
                    ? [summary.course, summary.session]
                        .filter(Boolean)
                        .join(" · ") || "—"
                    : "—"}
                </dd>
                <dt>{uiText("Phòng")}</dt>
                <dd>{summary?.room || "—"}</dd>
                <dt>{uiText("Nhận / trả")}</dt>
                <dd>
                  {dateTime.format(new Date(workspace.request.receive_at))} →{" "}
                  {dateTime.format(new Date(workspace.request.return_at))}
                </dd>
                <dt>{uiText("Phiên bản")}</dt>
                <dd>{workspace.request.revision}</dd>
              </dl>
              {lockable ? (
                <div className="kho-side-section">
                  {workspace.admin && attempt?.lock_holder ? (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        void command("override_lock", {
                          reason,
                          lock_token: null,
                        });
                      }}
                    >
                      <label>
                        {uiText("Lý do Admin nhả khóa")}
                        <input
                          required
                          value={reason}
                          onChange={(event) => setReason(event.target.value)}
                        />
                      </label>
                      <button
                        type="submit"
                        className="button button-secondary"
                        disabled={busy}
                      >
                        {uiText("Admin nhả khóa và ghi lịch sử")}
                      </button>
                    </form>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : (
            <ol className="kho-timeline">
              {history ? (
                <>
                  {history.rows.map((event) => (
                    <li key={event.id}>
                      <strong>{event.operation}</strong>
                      <small>
                        {dateTime.format(new Date(event.created_at))} ·{" "}
                        {event.actor_name ?? uiText("Hệ thống")}
                        {uiText(" · phiên bản ")}
                        {event.revision}
                      </small>
                      <details>
                        <summary>{uiText("Chi tiết kỹ thuật")}</summary>
                        <pre className="kho-pre">
                          {JSON.stringify(event.payload, null, 2)}
                        </pre>
                      </details>
                    </li>
                  ))}
                  <li className="kho-timeline-pages">
                    <button
                      type="button"
                      className="button button-secondary"
                      disabled={busy || history.page === 1}
                      onClick={() => void loadHistory(history.page - 1)}
                    >
                      {uiText("Lịch sử trước")}
                    </button>
                    <span>
                      {history.page} /{" "}
                      {Math.max(1, Math.ceil(history.total / 30))}
                    </span>
                    <button
                      type="button"
                      className="button button-secondary"
                      disabled={busy || history.page * 30 >= history.total}
                      onClick={() => void loadHistory(history.page + 1)}
                    >
                      {uiText("Lịch sử tiếp")}
                    </button>
                  </li>
                </>
              ) : (
                <li>{uiText("Đang tải lịch sử…")}</li>
              )}
            </ol>
          )}
        </aside>
      </div>
    </div>
  );
}
