"use client";

import { useRef, useState } from "react";
import { Download, UploadCloud } from "@/components/icons";
import { useLanguage } from "@/components/i18n/language-provider";

export function CatalogImportActions({
  action,
  catalog,
}: {
  action: (formData: FormData) => void | Promise<void>;
  catalog: "courses" | "rooms";
}) {
  const { text: uiText } = useLanguage();

  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [submitting, setSubmitting] = useState(false);

  return (
    <form action={action} className="catalog-import-actions" ref={formRef}>
      <a
        className="button button-secondary"
        download
        href={`/api/admin-catalog-template/${catalog}`}
      >
        <Download size={16} />
        {uiText(" Tải template")}
      </a>
      <input
        accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        aria-label={uiText("Chọn file import {0}", [
          catalog === "courses" ? uiText("môn học") : uiText("phòng"),
        ])}
        hidden
        name="file"
        onChange={(event) => {
          if (!event.currentTarget.files?.length) return;
          setSubmitting(true);
          formRef.current?.requestSubmit();
        }}
        ref={inputRef}
        type="file"
      />
      <button
        className="button button-primary"
        disabled={submitting}
        onClick={() => inputRef.current?.click()}
        type="button"
      >
        <UploadCloud size={16} />{" "}
        {submitting ? uiText("Đang import…") : "Import"}
      </button>
    </form>
  );
}
