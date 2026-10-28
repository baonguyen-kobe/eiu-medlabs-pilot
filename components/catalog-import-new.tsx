"use client";

import { useRef } from "react";
import { UploadCloud } from "@/components/icons";
import { useLanguage } from "@/components/i18n/language-provider";

export function CatalogImportNew({
  action,
}: {
  action: (formData: FormData) => void | Promise<void>;
}) {
  const { text: uiText } = useLanguage();

  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <form action={action} className="catalog-import-new-action">
      <input name="mode" type="hidden" value="new" />
      <label
        className="button equipment-import-new"
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
      >
        <UploadCloud size={17} />
        {uiText(" Import mới")}
        <input
          ref={inputRef}
          aria-hidden="true"
          className="sr-only"
          accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          name="file"
          tabIndex={-1}
          type="file"
          onChange={(event) => {
            if (event.currentTarget.files?.length) {
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
      </label>
    </form>
  );
}
