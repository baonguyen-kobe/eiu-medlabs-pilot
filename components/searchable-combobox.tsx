"use client";

import { ChevronRight, Search } from "@/components/icons";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLanguage } from "@/components/i18n/language-provider";

export type ComboboxOption = {
  value: string;
  label: string;
  keywords?: string;
};

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("vi")
    .trim();
}

export function SearchableCombobox({
  name,
  options,
  value,
  defaultValue = "",
  onChange,
  onQueryChange,
  placeholder = "Chọn hoặc nhập để tìm…",
  emptyLabel,
  required = false,
  disabled = false,
  ariaLabel,
}: {
  name?: string;
  options: ComboboxOption[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  onQueryChange?: (query: string) => void;
  placeholder?: string;
  emptyLabel?: string;
  required?: boolean;
  disabled?: boolean;
  ariaLabel: string;
}) {
  const { text: uiText } = useLanguage();

  const generatedId = useId();
  const listboxId = `${generatedId}-listbox`;
  const controlled = value !== undefined;
  const [internalValue, setInternalValue] = useState(defaultValue);
  const selectedValue = controlled ? value : internalValue;
  const selectedOption = options.find(
    (option) => option.value === selectedValue,
  );
  const [query, setQuery] = useState(selectedOption?.label ?? "");
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [listStyle, setListStyle] = useState<React.CSSProperties>({});
  const displayQuery = open ? query : (selectedOption?.label ?? "");

  useEffect(() => {
    function closeOnOutsideClick(event: PointerEvent) {
      if (
        !rootRef.current?.contains(event.target as Node) &&
        !listRef.current?.contains(event.target as Node)
      )
        setOpen(false);
    }
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () =>
      document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, []);

  useEffect(() => {
    if (!open) return;
    function positionList() {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      const spaceBelow = window.innerHeight - rect.bottom;
      setListStyle({
        left: rect.left,
        width: rect.width,
        top: spaceBelow >= 220 ? rect.bottom + 5 : undefined,
        bottom:
          spaceBelow < 220 ? window.innerHeight - rect.top + 5 : undefined,
      });
    }
    positionList();
    window.addEventListener("resize", positionList);
    window.addEventListener("scroll", positionList, true);
    return () => {
      window.removeEventListener("resize", positionList);
      window.removeEventListener("scroll", positionList, true);
    };
  }, [open]);

  const filtered = useMemo(() => {
    const term = normalize(query);
    if (!term || query === selectedOption?.label) return options;
    return options.filter((option) =>
      normalize(`${option.label} ${option.keywords ?? ""}`).includes(term),
    );
  }, [options, query, selectedOption?.label]);

  function select(nextValue: string) {
    const nextOption = options.find((option) => option.value === nextValue);
    if (!controlled) setInternalValue(nextValue);
    onChange?.(nextValue);
    setQuery(nextOption?.label ?? "");
    setOpen(false);
  }

  return (
    <div className="searchable-combobox" ref={rootRef}>
      {name ? <input name={name} type="hidden" value={selectedValue} /> : null}
      <span className="searchable-combobox-control">
        <Search size={17} />
        <input
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-expanded={open}
          aria-label={uiText(ariaLabel)}
          autoComplete="off"
          disabled={disabled}
          placeholder={uiText(placeholder)}
          required={required}
          role="combobox"
          value={displayQuery}
          onChange={(event) => {
            setQuery(event.target.value);
            onQueryChange?.(event.target.value);
            if (selectedValue) {
              if (!controlled) setInternalValue("");
              onChange?.("");
            }
            setOpen(true);
          }}
          onFocus={() => {
            setQuery(selectedOption?.label ?? "");
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
            if (event.key === "Enter" && open && filtered.length === 1) {
              event.preventDefault();
              select(filtered[0].value);
            }
          }}
        />
        <ChevronRight className="combobox-chevron" size={16} />
      </span>
      {open && !disabled
        ? createPortal(
            <div
              className="searchable-combobox-list searchable-combobox-portal"
              ref={listRef}
              style={listStyle}
              id={listboxId}
              role="listbox"
            >
              {emptyLabel ? (
                <button
                  className={!selectedValue ? "selected" : ""}
                  role="option"
                  aria-selected={!selectedValue}
                  type="button"
                  onClick={() => select("")}
                >
                  {uiText(emptyLabel)}
                </button>
              ) : null}
              {filtered.map((option) => (
                <button
                  className={option.value === selectedValue ? "selected" : ""}
                  key={option.value}
                  role="option"
                  aria-selected={option.value === selectedValue}
                  type="button"
                  onClick={() => select(option.value)}
                >
                  {option.label}
                </button>
              ))}
              {!filtered.length ? (
                <p>{uiText("Không tìm thấy kết quả phù hợp.")}</p>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
