"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, X } from "@/components/icons";

export function ConfirmActionModal({
  open,
  title,
  description,
  targetName,
  currentRevision,
  actionLabel,
  actionVariant = "danger",
  isPending = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description: string;
  targetName: string;
  currentRevision: string | number;
  actionLabel: string;
  actionVariant?: "danger" | "primary" | "warning";
  isPending?: boolean;
  onConfirm: (reason: string) => Promise<void>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const titleId = useId();
  const descId = useId();
  const errorId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);

  // Focus management & Escape key handling
  useEffect(() => {
    if (!open) return;

    previousActiveElementRef.current =
      document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Auto-focus textarea
    const timer = setTimeout(() => {
      textareaRef.current?.focus();
    }, 50);

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isPending) {
        onClose();
        return;
      }

      if (event.key !== "Tab") return;
      const modal = modalRef.current;
      if (!modal) return;

      const focusable = Array.from(
        modal.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => !el.hasAttribute("hidden"));

      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey) {
        if (active === first || !modal.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last || !modal.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousActiveElementRef.current?.focus();
    };
  }, [open, isPending, onClose]);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim()) {
      setError("Vui lòng nhập lý do thực hiện thao tác / Reason is required");
      textareaRef.current?.focus();
      return;
    }
    setError(null);
    try {
      await onConfirm(reason.trim());
      setReason("");
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Thao tác thất bại");
      textareaRef.current?.focus();
    }
  }

  const btnClass =
    actionVariant === "danger"
      ? "button button-danger text-xs font-semibold px-4 py-2"
      : actionVariant === "warning"
        ? "button button-secondary text-amber-700 border-amber-300 text-xs font-semibold px-4 py-2"
        : "button button-primary text-xs font-semibold px-4 py-2";

  const modalContent = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descId}
    >
      <div
        ref={modalRef}
        className="relative w-full max-w-md bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden dark:bg-slate-900 dark:border-slate-800"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50 dark:border-slate-800 dark:bg-slate-800/40">
          <div className="flex items-center gap-2 text-slate-800 dark:text-slate-100 font-semibold">
            {actionVariant === "danger" || actionVariant === "warning" ? (
              <AlertTriangle className="text-amber-500 shrink-0" size={20} />
            ) : null}
            <h3
              id={titleId}
              className="text-base font-bold text-slate-900 dark:text-slate-100"
            >
              {title}
            </h3>
          </div>
          <button
            type="button"
            className="text-slate-400 hover:text-slate-600 rounded-lg p-1 dark:hover:text-slate-200"
            onClick={onClose}
            disabled={isPending}
            aria-label="Đóng hộp thoại"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <p
            id={descId}
            className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed"
          >
            {description}
          </p>

          <div className="rounded-lg bg-slate-50 border border-slate-100 p-3 space-y-1 text-xs dark:bg-slate-800/50 dark:border-slate-800">
            <div className="flex justify-between">
              <span className="text-slate-500 dark:text-slate-400 font-medium">
                Đối tượng / Target:
              </span>
              <span className="font-semibold text-slate-800 dark:text-slate-200">
                {targetName}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500 dark:text-slate-400 font-medium">
                Phiên bản hiện tại / Current revision:
              </span>
              <span className="font-mono text-slate-700 dark:text-slate-300 font-semibold">
                r{String(currentRevision)}
              </span>
            </div>
          </div>

          <div>
            <label
              htmlFor="confirm-modal-reason"
              className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
            >
              Lý do thực hiện <span className="text-red-500">*</span>
            </label>
            <textarea
              ref={textareaRef}
              id="confirm-modal-reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={isPending}
              placeholder="Ghi rõ căn cứ / lý do thực hiện thao tác này…"
              aria-required="true"
              aria-invalid={Boolean(error)}
              aria-describedby={error ? errorId : undefined}
              className="w-full text-xs rounded-lg border border-slate-300 p-2.5 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white text-slate-900 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-100"
            />
          </div>

          {error ? (
            <div
              id={errorId}
              role="alert"
              aria-live="polite"
              className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 p-2.5 rounded-lg border border-red-200 dark:border-red-900/40 font-medium"
            >
              {error}
            </div>
          ) : null}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              className="button button-secondary text-xs px-3 py-2"
              onClick={onClose}
              disabled={isPending}
            >
              Hủy bỏ / Cancel
            </button>
            <button
              type="submit"
              className={btnClass}
              disabled={isPending || !reason.trim()}
            >
              {isPending ? "Đang xử lý…" : actionLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  return typeof document !== "undefined"
    ? createPortal(modalContent, document.body)
    : modalContent;
}
