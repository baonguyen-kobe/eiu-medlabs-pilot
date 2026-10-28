"use client";

import {
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { AlertTriangle } from "@/components/icons";
import { useLanguage } from "@/components/i18n/language-provider";

function emptySubscribe() {
  return () => {};
}

function useIsClient() {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Xác nhận",
  cancelLabel = "Quay lại",
  tone = "danger",
  pending = false,
  confirmDisabled = false,
  className,
  children,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
  pending?: boolean;
  confirmDisabled?: boolean;
  className?: string;
  children?: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { text: uiText } = useLanguage();

  const mounted = useIsClient();
  const titleId = useId();
  const descriptionId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const onCancelRef = useRef(onCancel);
  const pendingRef = useRef(pending);

  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);

  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  useEffect(() => {
    if (!open) return;
    const previousActiveElement = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    cancelRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !pendingRef.current) {
        onCancelRef.current?.();
        return;
      }

      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => !element.hasAttribute("hidden"));
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey) {
        if (active === first || !dialog.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last || !dialog.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousActiveElement?.focus();
    };
  }, [open]);

  if (!open || !mounted) return null;

  return createPortal(
    <div className="confirm-dialog-layer">
      <button
        type="button"
        className="confirm-dialog-backdrop"
        aria-label={uiText("Đóng hộp thoại xác nhận")}
        onClick={onCancel}
        disabled={pending}
      />
      <section
        ref={dialogRef}
        className={`confirm-dialog${className ? ` ${className}` : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <div className="confirm-dialog-header">
          <div className={`confirm-dialog-icon confirm-dialog-icon-${tone}`}>
            <AlertTriangle size={26} />
          </div>
          <div className="confirm-dialog-copy">
            <h2 id={titleId}>{uiText(title)}</h2>
            <p id={descriptionId}>{uiText(description)}</p>
          </div>
        </div>
        {children ? (
          <div className="confirm-dialog-body">{children}</div>
        ) : null}
        <footer className="confirm-dialog-actions">
          <button
            ref={cancelRef}
            type="button"
            className="button button-secondary"
            onClick={onCancel}
            disabled={pending}
          >
            {uiText(cancelLabel)}
          </button>
          <button
            type="button"
            className={`button ${tone === "danger" ? "button-danger" : "button-primary"}`}
            onClick={onConfirm}
            disabled={pending || confirmDisabled}
          >
            {pending ? uiText("Đang xử lý…") : uiText(confirmLabel)}
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
