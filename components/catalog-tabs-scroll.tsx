"use client";

import { useEffect, useRef } from "react";

/** Scrolls the active catalog tab into view inside its one-row nav. */
export function CatalogTabsScroll() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    ref.current?.parentElement
      ?.querySelector("[aria-current]")
      ?.scrollIntoView({ inline: "center", block: "nearest" });
  }, []);
  return <span ref={ref} hidden />;
}
