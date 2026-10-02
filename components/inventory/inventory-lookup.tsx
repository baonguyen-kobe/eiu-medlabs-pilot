"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronRight, Search, X } from "@/components/icons";
import { PaginationControls } from "@/components/pagination-controls";
import { readInventoryOptions } from "@/app/inventory/read-actions";
import type {
  InventoryReadFilters,
  InventoryResource,
} from "@/lib/inventory/types";

export interface InventoryLookupProps<T = Record<string, unknown>> {
  resource: InventoryResource;
  filters?: InventoryReadFilters;
  value: string;
  valueKey?: "id" | "code";
  label: string;
  id: string;
  selectedLabel?: string;
  onSelect: (row: T) => void;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
  className?: string;
  hideLabel?: boolean;
}

export interface RowDisplay {
  label: string;
  subLabel?: string;
  key: string;
}

/**
 * Derives display label and secondary metadata for any inventory resource row.
 */
export function deriveRowDisplay(row: Record<string, unknown>): RowDisplay {
  if (!row) return { label: "", key: "" };

  const id = String(row.id ?? row.code ?? row.line_key ?? "");

  // Source Line derivation
  if (row.line_key !== undefined) {
    const parts = [
      row.item_name || row.item_code,
      row.expected_purchase_quantity && row.purchase_uom_code
        ? `${row.expected_purchase_quantity} ${row.purchase_uom_code}`
        : null,
    ].filter(Boolean);

    return {
      label: `${row.line_key}${parts.length ? `: ${parts.join(" - ")}` : ""}`,
      subLabel: row.item_code ? `SKU: ${row.item_code}` : undefined,
      key: String(row.id ?? row.line_key),
    };
  }

  // Acquisition source derivation
  if (row.source_reference !== undefined) {
    const subParts = [row.supplier_name, row.reference_date]
      .filter(Boolean)
      .map(String);
    return {
      label: String(row.source_reference),
      subLabel: subParts.length > 0 ? subParts.join(" • ") : undefined,
      key: String(row.id ?? row.source_reference),
    };
  }

  // Master item / category / location / supplier with name
  if (row.name !== undefined && row.name !== null) {
    const nameStr = String(row.name);
    return {
      label: nameStr,
      subLabel: row.code ? `Mã / Code: ${row.code}` : undefined,
      key: String(row.id ?? row.code),
    };
  }

  // Code-first fallback (e.g. UOM)
  if (row.code !== undefined && row.code !== null) {
    return {
      label: String(row.code),
      subLabel: row.id ? `ID: ${row.id}` : undefined,
      key: String(row.id ?? row.code),
    };
  }

  return {
    label: id || "N/A",
    key: id,
  };
}

export function InventoryLookup<T = Record<string, unknown>>({
  resource,
  filters,
  value,
  valueKey = "id",
  label,
  id,
  selectedLabel,
  onSelect,
  disabled = false,
  required = false,
  placeholder = "Chọn hoặc tìm kiếm… / Select or search…",
  className = "",
  hideLabel = false,
}: InventoryLookupProps<T>) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const [rows, setRows] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cached display for selected value if selectedLabel was not passed
  const [resolvedDisplay, setResolvedDisplay] = useState<RowDisplay | null>(
    null,
  );

  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});

  const listboxId = `${id}-listbox`;
  const labelId = `${id}-label`;

  // Helper to extract value key comparison
  const getRowValue = useCallback(
    (row: unknown): string => {
      if (!row || typeof row !== "object") return "";
      const record = row as Record<string, unknown>;
      return String(record[valueKey] ?? record.id ?? record.code ?? "");
    },
    [valueKey],
  );

  // Resolve display label when value changes and selectedLabel is missing
  useEffect(() => {
    if (!value) {
      const timer = setTimeout(() => setResolvedDisplay(null), 0);
      return () => clearTimeout(timer);
    }
    if (selectedLabel) {
      const timer = setTimeout(
        () => setResolvedDisplay({ label: selectedLabel, key: value }),
        0,
      );
      return () => clearTimeout(timer);
    }
    let cancelled = false;
    readInventoryOptions<T>(resource, {
      ...filters,
      [valueKey]: value,
      page: 1,
      page_size: 1,
    })
      .then((res) => {
        if (cancelled) return;
        if (res.rows.length > 0) {
          const display = deriveRowDisplay(
            res.rows[0] as Record<string, unknown>,
          );
          setResolvedDisplay(display);
        }
      })
      .catch(() => {
        // Non-blocking fallback
      });

    return () => {
      cancelled = true;
    };
  }, [resource, value, valueKey, selectedLabel, filters]);

  // Load bounded options on open or filter/q/page change
  const fetchOptions = useCallback(
    async (searchQuery: string, pageNum: number) => {
      setLoading(true);
      setError(null);
      try {
        const res = await readInventoryOptions<T>(resource, {
          ...filters,
          q: searchQuery.trim() || undefined,
          page: pageNum,
          page_size: pageSize,
        });
        setRows(res.rows);
        setTotal(res.total);
      } catch (err: unknown) {
        setError(
          err instanceof Error
            ? err.message
            : "Lỗi tải dữ liệu / Failed to load options",
        );
      } finally {
        setLoading(false);
      }
    },
    [resource, filters, pageSize],
  );

  // Position calculation for portal
  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const desiredWidth = Math.max(rect.width, 340);
    const left = Math.max(
      8,
      Math.min(rect.left, window.innerWidth - desiredWidth - 8),
    );

    setDropdownStyle({
      position: "fixed",
      left,
      width: desiredWidth,
      zIndex: 9999,
      top:
        spaceBelow >= 280 || spaceBelow >= spaceAbove
          ? rect.bottom + 4
          : undefined,
      bottom:
        spaceBelow < 280 && spaceAbove > spaceBelow
          ? window.innerHeight - rect.top + 4
          : undefined,
    });
  }, []);

  // When open opens, trigger fetch and focus search input
  useEffect(() => {
    if (!open) return;
    const timerQ = setTimeout(() => {
      setQ("");
      setPage(1);
      fetchOptions("", 1);
    }, 0);
    updatePosition();
    const handleScrollOrResize = () => updatePosition();
    window.addEventListener("scroll", handleScrollOrResize, true);
    window.addEventListener("resize", handleScrollOrResize);

    const timer = setTimeout(() => {
      searchInputRef.current?.focus();
    }, 40);

    return () => {
      clearTimeout(timer);
      window.removeEventListener("scroll", handleScrollOrResize, true);
      window.removeEventListener("resize", handleScrollOrResize);
    };
  }, [open, fetchOptions, updatePosition]);

  // Outside click to close
  useEffect(() => {
    if (!open) return;
    function handleClickOutside(event: PointerEvent) {
      if (
        !triggerRef.current?.contains(event.target as Node) &&
        !dropdownRef.current?.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", handleClickOutside);
    return () =>
      document.removeEventListener("pointerdown", handleClickOutside);
  }, [open]);

  // Handle ESC and keyboard
  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      setOpen(false);
      triggerRef.current?.focus();
    }
  };

  const handleSelect = (row: T) => {
    const rowRec = row as Record<string, unknown>;
    const display = deriveRowDisplay(rowRec);
    setResolvedDisplay(display);
    onSelect(row);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const handleSearchChange = (newQ: string) => {
    setQ(newQ);
    setPage(1);
    fetchOptions(newQ, 1);
  };

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    fetchOptions(q, newPage);
  };

  // Determine current display text
  const currentDisplayText =
    selectedLabel || resolvedDisplay?.label || (value ? `${value}` : "");

  return (
    <div className={`relative ${className}`}>
      {!hideLabel && (
        <label
          id={labelId}
          htmlFor={id}
          className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1"
        >
          {label}
          {required ? <span className="text-red-500 ml-0.5">*</span> : null}
        </label>
      )}

      {/* Trigger Button */}
      <button
        ref={triggerRef}
        id={id}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen(true);
          }
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-labelledby={hideLabel ? undefined : labelId}
        aria-label={hideLabel ? label : undefined}
        className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-xs rounded-lg border text-left transition-colors ${
          disabled
            ? "bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed dark:bg-slate-800 dark:border-slate-700"
            : "bg-white border-slate-300 text-slate-900 hover:border-slate-400 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-100"
        }`}
      >
        <div className="truncate flex-1">
          {currentDisplayText ? (
            <div className="flex flex-col">
              <span className="font-medium text-slate-900 dark:text-slate-100 truncate">
                {currentDisplayText}
              </span>
              {resolvedDisplay?.subLabel && (
                <span className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  {resolvedDisplay.subLabel}
                </span>
              )}
            </div>
          ) : (
            <span className="text-slate-400 dark:text-slate-500">
              {placeholder}
            </span>
          )}
        </div>
        <ChevronRight
          size={14}
          className={`shrink-0 text-slate-400 transition-transform ${
            open ? "rotate-90 text-indigo-600" : ""
          }`}
        />
      </button>

      {/* Portal Dropdown */}
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={dropdownRef}
            style={dropdownStyle}
            onKeyDown={handleKeyDown}
            className="rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900 overflow-hidden flex flex-col max-h-[380px]"
          >
            {/* Search Header */}
            <div className="p-2 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40">
              <div className="relative">
                <Search
                  size={14}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
                />
                <input
                  ref={searchInputRef}
                  type="search"
                  value={q}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  placeholder="Tìm kiếm theo mã, tên… / Search…"
                  className="w-full pl-8 pr-7 py-1.5 text-xs rounded-md border border-slate-200 bg-white text-slate-900 focus:outline-hidden focus:ring-1 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
                {q ? (
                  <button
                    type="button"
                    onClick={() => handleSearchChange("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
                    aria-label="Xóa tìm kiếm"
                  >
                    <X size={12} />
                  </button>
                ) : null}
              </div>
            </div>

            {/* Listbox Options */}
            <div
              id={listboxId}
              role="listbox"
              aria-label={label}
              className="flex-1 overflow-y-auto p-1 divide-y divide-slate-100/60 dark:divide-slate-800/60 focus:outline-hidden"
              tabIndex={-1}
            >
              {loading ? (
                <div className="p-4 text-center text-xs text-slate-500">
                  Đang tải dữ liệu… / Loading…
                </div>
              ) : error ? (
                <div className="p-3 text-xs text-red-600 dark:text-red-400 text-center space-y-1">
                  <p>{error}</p>
                  <button
                    type="button"
                    onClick={() => fetchOptions(q, page)}
                    className="text-xs text-indigo-600 underline font-medium"
                  >
                    Thử lại / Retry
                  </button>
                </div>
              ) : rows.length === 0 ? (
                <div className="p-4 text-center text-xs text-slate-500 dark:text-slate-400">
                  Không tìm thấy kết quả phù hợp / No matching results
                </div>
              ) : (
                rows.map((row, idx) => {
                  const rowRec = row as Record<string, unknown>;
                  const rowVal = getRowValue(row);
                  const isSelected = rowVal === value;
                  const display = deriveRowDisplay(rowRec);

                  return (
                    <button
                      key={`${display.key}-${idx}`}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => handleSelect(row)}
                      className={`w-full text-left px-3 py-2 rounded-lg text-xs flex items-center justify-between gap-2 transition-colors ${
                        isSelected
                          ? "bg-indigo-50 text-indigo-900 font-semibold dark:bg-indigo-950/40 dark:text-indigo-200"
                          : "hover:bg-slate-50 text-slate-800 dark:text-slate-200 dark:hover:bg-slate-800"
                      }`}
                    >
                      <div className="flex-1 truncate">
                        <div className="truncate text-xs">{display.label}</div>
                        {display.subLabel && (
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                            {display.subLabel}
                          </div>
                        )}
                      </div>
                      {isSelected ? (
                        <Check
                          size={14}
                          className="shrink-0 text-indigo-600 dark:text-indigo-400"
                        />
                      ) : null}
                    </button>
                  );
                })
              )}
            </div>

            {/* Bounded Pagination Footer */}
            {total > pageSize && (
              <div className="p-2 border-t border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 flex flex-col items-center gap-1">
                <PaginationControls
                  currentPage={page}
                  totalItems={total}
                  pageSize={pageSize}
                  onPageChange={handlePageChange}
                />
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  Tổng {total} kết quả (trang {page})
                </span>
              </div>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
