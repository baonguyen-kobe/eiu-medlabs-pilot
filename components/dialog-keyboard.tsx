"use client";

import { useEffect, useRef } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Focus in, Tab trapped, Escape closes the topmost dialog, focus back to the opener (UI Master §36). */
export function DialogKeyboard({
  onClose,
  pending = false,
}: {
  onClose: () => void;
  pending?: boolean;
}) {
  const anchor = useRef<HTMLSpanElement>(null);
  const onCloseRef = useRef(onClose);
  const pendingRef = useRef(pending);

  useEffect(() => {
    onCloseRef.current = onClose;
    pendingRef.current = pending;
  }, [onClose, pending]);

  useEffect(() => {
    const dialog = anchor.current?.closest<HTMLElement>('[role="dialog"]');
    if (!dialog) return;
    const opener = document.activeElement as HTMLElement | null;

    const getFocusable = () =>
      Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (element) => !element.hasAttribute("hidden"),
      );

    const initial =
      dialog.querySelector<HTMLElement>("[data-autofocus]") ??
      dialog.querySelector<HTMLElement>(
        'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled])',
      ) ??
      getFocusable()[0];
    if (initial) {
      initial.focus();
    } else {
      if (!dialog.hasAttribute("tabindex")) dialog.tabIndex = -1;
      dialog.focus();
    }

    function handleKeyDown(event: KeyboardEvent) {
      const dialogs = document.querySelectorAll('[role="dialog"]');
      if (dialogs[dialogs.length - 1] !== dialog) return;

      if (event.key === "Escape") {
        if (pendingRef.current) return;
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key !== "Tab") return;
      const focusable = getFocusable();
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey) {
        if (active === first || !dialog!.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last || !dialog!.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  return <span ref={anchor} hidden />;
}
