"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import Link from "next/link";
import {
  changePreparation,
  readPreparation,
} from "@/app/equipment/preparation/actions";
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
}: {
  initial: PreparationWorkspace;
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
      if (operation === "start") setOwned(true);
      if (
        [
          "release_lock",
          "confirm",
          "override_lock",
          "begin_reversal",
          "finalize_reversal",
        ].includes(operation)
      )
        setOwned(false);
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
  return (
    <div className={`${styles.root} space-y-6`}>
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
      <header className="space-y-2">
        <Link
          className="text-link"
          href={workspace.manager ? "/equipment/requests" : "/equipment/mine"}
        >
          {uiText("Về danh sách phiếu")}
        </Link>
        <h2>{uiText("Chuẩn bị thiết bị")}</h2>
        <p>
          {uiText("Nhận: ")}
          {dateTime.format(new Date(workspace.request.receive_at))}
          {uiText(" · Trả dự kiến: ")}
          {dateTime.format(new Date(workspace.request.return_at))}
        </p>
        <p>
          {uiText("Phiên bản ")}
          {workspace.request.revision} ·{" "}
          {attempt?.state ?? uiText("Chưa bắt đầu")}
        </p>
        {prepared ? (
          <div>
            <p>
              {uiText(
                "Đã xác nhận chuẩn bị. Tiếp tục ghi nhận thực giao, thực nhận và ký xác nhận theo từng lần bàn giao/thu hồi.",
              )}
            </p>
            <Link
              className="button button-primary"
              href={`/equipment/fulfillment/${requestId}`}
            >
              {uiText("Bàn giao, thu hồi và ký xác nhận")}
            </Link>
          </div>
        ) : null}
        <button
          type="button"
          className="button button-secondary"
          disabled={busy}
          onClick={() => void refresh()}
        >
          {uiText("Tải phiên bản mới, giữ nội dung đang nhập")}
        </button>
      </header>
      {message ? (
        <p role="status" aria-live="polite" className="rounded-xl border p-3">
          <LocalizedText text={message ?? ""} />
        </p>
      ) : null}
      {attempt?.health.length ? (
        <section
          role="alert"
          className="rounded-xl border border-amber-500 p-4"
        >
          <h2 className="font-semibold">{uiText("Cần phân bổ lại")}</h2>
          <p>
            {uiText("Cam kết vẫn được giữ. Nguồn đủ điều kiện không đủ cho")}{" "}
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
      <fieldset disabled={uncertain} className="min-w-0 space-y-4">
        {workspace.manager &&
        workspace.request.status === "new" &&
        (!attempt ||
          ["draft", "reversed", "cancelled"].includes(attempt.state)) ? (
          <section className="rounded-xl border p-4 space-y-3">
            <h2 className="font-semibold">
              {uiText("Khóa toàn tab chuẩn bị")}
            </h2>
            <p>
              {owned
                ? uiText("Tab này đang giữ khóa.")
                : attempt?.lock_holder
                  ? uiText("Khóa đang do {0} giữ đến {1}.", [
                      attempt.lock_holder,
                      dateTime.format(new Date(attempt.lock_expires_at!)),
                    ])
                  : uiText("Chưa có tab giữ khóa.")}{" "}
              {uiText(
                "Bắt đầu không giữ tồn; chỉ confirmed PREPARED mới reserve.",
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="button"
                disabled={busy || owned}
                onClick={() => {
                  const value = lockToken ?? crypto.randomUUID();
                  setLockToken(value);
                  void command("start", { lock_token: value });
                }}
              >
                {uiText("Bắt đầu / Tiếp tục chuẩn bị")}
              </button>
              {owned ? (
                <>
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
                    className="button button-secondary"
                    disabled={busy}
                    onClick={() =>
                      void command("release_lock", { lock_token: lockToken })
                    }
                  >
                    {uiText("Nhả khóa tab")}
                  </button>
                  <button
                    type="button"
                    className="button"
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          "Xác nhận PREPARED: giữ cứng đúng số lượng/tài sản trong plan và gửi thông báo tổng hợp?",
                        )
                      )
                        void command("confirm", {
                          lock_token: lockToken,
                          draft_revision: attempt?.revision ?? 1,
                          plan,
                        });
                    }}
                  >
                    {uiText("Xác nhận đã chuẩn bị")}
                  </button>
                </>
              ) : null}
            </div>
            {workspace.admin && attempt?.lock_holder ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void command("override_lock", { reason, lock_token: null });
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
          </section>
        ) : null}
        <section
          className="space-y-4"
          aria-label={uiText("Dòng thiết bị và phân bổ")}
        >
          {[...workspace.lines, ...pendingLines].map((demand) => {
            const line = plan.lines.find((row) => row.line_id === demand.id);
            if (!line) return null;
            return (
              <article
                key={demand.id}
                className="rounded-xl border p-4 space-y-3"
              >
                <h2 className="font-semibold">
                  {demand.skill_name} ·{" "}
                  {demand.commercial_name || demand.item_name}
                </h2>
                <p>
                  {uiText("SL đăng ký: ")}
                  <strong>{demand.registered_quantity}</strong> {demand.unit}
                  {uiText(" · SL sẽ giao hiện hành:")}{" "}
                  <strong>{demand.planned_quantity}</strong> {demand.unit}
                </p>
                {demand.baseline_source === "cutover_snapshot" ? (
                  <p>
                    {uiText(
                      "Baseline chụp tại cutover; không khẳng định đây là số lượng đăng ký nguyên bản.",
                    )}
                  </p>
                ) : null}
                {demand.baseline_source === "added" ? (
                  <p>
                    {uiText("Dòng thêm sau đăng ký; baseline đăng ký = 0.")}
                  </p>
                ) : null}
                {demand.baseline_source === "pending_addition" ? (
                  <p>
                    {uiText(
                      "Dòng đề nghị mới đang rà soát; chưa thuộc plan hiện hành và chưa giữ tồn.",
                    )}
                  </p>
                ) : null}
                {demand.note ? (
                  <p>
                    {uiText("Ghi chú: ")}
                    {demand.note}
                  </p>
                ) : null}
                {workspace.manager ? (
                  <>
                    <label>
                      {uiText("SL chuẩn bị trong plan")}
                      <input
                        inputMode="numeric"
                        pattern="[0-9]+"
                        value={line.planned_quantity}
                        disabled={!editable}
                        onChange={(event) =>
                          updateLine(demand.id, {
                            planned_quantity: event.target.value,
                          })
                        }
                      />
                    </label>
                    <label>
                      {uiText("Lý do chuẩn bị thiếu")}
                      <input
                        value={line.shortage_reason}
                        disabled={!editable}
                        onChange={(event) =>
                          updateLine(demand.id, {
                            shortage_reason: event.target.value,
                          })
                        }
                      />
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={
                          line.reviewed_revision === demand.line_revision
                        }
                        disabled={!editable}
                        onChange={(event) =>
                          updateLine(demand.id, {
                            reviewed_revision: event.target.checked
                              ? demand.line_revision
                              : null,
                          })
                        }
                      />
                      {uiText("Đã rà soát dòng phiên bản ")}
                      {demand.line_revision}
                    </label>
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
                    {uiText("SL đề nghị tuyệt đối (0 = ngừng giao dòng này)")}
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
              </article>
            );
          })}
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
            {target.skill_name} · {target.commercial_name} · {target.quantity}{" "}
            {target.unit}{" "}
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
            className="rounded-xl border p-4 space-y-3"
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
            <h2 className="font-semibold">{uiText("Đề nghị điều chỉnh")}</h2>
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
                workspace.adjustments.some((row) => row.status === "pending")
              }
            >
              {uiText("Gửi đề nghị chờ duyệt")}
            </button>
          </form>
        ) : null}
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">{uiText("Đề nghị gần đây")}</h2>
          {workspace.adjustments.map((adjustment) => (
            <article
              key={adjustment.id}
              className="rounded-xl border p-4 space-y-2"
            >
              <p>
                {adjustment.status === "pending"
                  ? uiText("Chờ duyệt")
                  : adjustment.status === "approved"
                    ? uiText("Đã duyệt")
                    : uiText("Đã từ chối")}
                {uiText(" · Gửi tại phiên bản")} {adjustment.submitted_revision}{" "}
                · {adjustment.reason}
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
        {workspace.manager ? (
          <EquipmentPreparationTransfers
            workspace={workspace}
            lockToken={owned ? lockToken : null}
            disabled={commandBusy || uncertain}
            onWorkspace={(next) => reconcile(next, true)}
            onBusyChange={setTransferBusy}
          />
        ) : null}
        {workspace.manager &&
        (prepared ||
          attempt?.state === "reversing" ||
          (owned &&
            attempt?.state === "draft" &&
            workspace.transfers.length > 0)) ? (
          <section className="rounded-xl border p-4 space-y-3">
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
                  onClick={() => void command("reallocate", { plan, reason })}
                >
                  {uiText("Phân bổ lại, giữ SL sẽ giao")}
                </button>
              ) : null}
              {attempt?.state !== "reversing" ? (
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={busy || !reason.trim()}
                  onClick={() => {
                    if (
                      window.confirm(
                        "Bắt đầu đảo chuẩn bị? Mọi chuyển kho liên quan phải chuyển trả thực tế về nguồn gốc trước khi hoàn tất.",
                      )
                    )
                      void command("begin_reversal", {
                        reason,
                        lock_token: lockToken,
                      });
                  }}
                >
                  {uiText("Bắt đầu đảo chuẩn bị")}
                </button>
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
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{uiText("Lịch sử bất biến")}</h2>
        <button
          type="button"
          className="button button-secondary"
          disabled={busy}
          onClick={() => void loadHistory(1)}
        >
          {uiText("Tải lịch sử")}
        </button>
        {history ? (
          <>
            <ol className="space-y-2">
              {history.rows.map((event) => (
                <li key={event.id}>
                  <details>
                    <summary>
                      {dateTime.format(new Date(event.created_at))} ·{" "}
                      {event.actor_name ?? uiText("Hệ thống")} ·{" "}
                      {event.operation}
                      {uiText(" · phiên bản ")}
                      {event.revision}
                    </summary>
                    <pre className="overflow-auto whitespace-pre-wrap text-xs">
                      {JSON.stringify(event.payload, null, 2)}
                    </pre>
                  </details>
                </li>
              ))}
            </ol>
            <div className="flex gap-2">
              <button
                type="button"
                className="button button-secondary"
                disabled={busy || history.page === 1}
                onClick={() => void loadHistory(history.page - 1)}
              >
                {uiText("Lịch sử trước")}
              </button>
              <span>
                {history.page} / {Math.max(1, Math.ceil(history.total / 30))}
              </span>
              <button
                type="button"
                className="button button-secondary"
                disabled={busy || history.page * 30 >= history.total}
                onClick={() => void loadHistory(history.page + 1)}
              >
                {uiText("Lịch sử tiếp")}
              </button>
            </div>
          </>
        ) : null}
      </section>
    </div>
  );
}
