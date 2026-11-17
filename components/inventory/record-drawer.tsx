"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "@/components/icons";
import { useLanguage } from "@/components/i18n/language-provider";

/**
 * 520px record drawer (UI Master 0A.2, section 36): sticky header and footer,
 * scrolling body, Escape and scrim close, focus moves in and returns on close.
 */
export function RecordDrawer({
  title,
  subtitle,
  onClose,
  actions,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { text } = useLanguage();
  const drawerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    drawerRef.current?.focus();
    // While a dialog is open on top of the drawer, Escape belongs to it.
    const onKey = (event: KeyboardEvent) => {
      const dialogOnTop = Array.from(
        document.querySelectorAll('[role="dialog"]'),
      ).some((dialog) => dialog !== drawerRef.current);
      if (event.key === "Escape" && !dialogOnTop) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, [onClose]);

  return (
    <>
      <button
        type="button"
        className="drawer-scrim"
        aria-label={text("Đóng chi tiết")}
        onClick={onClose}
      />
      <aside
        ref={drawerRef}
        className="detail-drawer record-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="record-drawer-title"
        tabIndex={-1}
      >
        <header className="record-drawer-head">
          <div>
            <h2 id="record-drawer-title">{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label={text("Đóng")}
            onClick={onClose}
          >
            <X size={19} />
          </button>
        </header>
        <div className="record-drawer-body">{children}</div>
        <footer className="record-drawer-foot">
          {actions}
          <button
            type="button"
            className="button button-secondary"
            onClick={onClose}
          >
            {text("Đóng")}
          </button>
        </footer>
      </aside>
    </>
  );
}
