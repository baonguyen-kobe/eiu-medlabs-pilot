"use client";

import { useRef, useState } from "react";
import { UploadCloud } from "@/components/icons";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useLanguage } from "@/components/i18n/language-provider";

const REPLACE_PHRASE = "THAY TOÀN BỘ";

export function PersonnelImportButtons() {
  const { text: uiText } = useLanguage();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const allRef = useRef<HTMLButtonElement>(null);
  const confirmed = useRef(false);

  function close() {
    setOpen(false);
    setTyped("");
  }

  return (
    <>
      <button className="button equipment-import-new" name="mode" value="new">
        <UploadCloud size={17} />
        {uiText(" Import mới")}
      </button>
      <button
        ref={allRef}
        className="button equipment-import-all"
        name="mode"
        value="all"
        onClick={(event) => {
          if (confirmed.current) return;
          event.preventDefault();
          setOpen(true);
        }}
      >
        <UploadCloud size={17} />
        {uiText(" Import tất cả")}
      </button>
      <ConfirmDialog
        open={open}
        title="Thay toàn bộ danh sách nhân sự?"
        description="Danh sách nhân sự hiện tại sẽ bị thay bằng tệp vừa chọn. Chỉ tài khoản Quản trị viên được giữ nguyên."
        confirmLabel="Thay toàn bộ"
        confirmDisabled={typed.trim() !== REPLACE_PHRASE}
        onCancel={close}
        onConfirm={() => {
          close();
          // Re-click so the form still posts mode=all.
          confirmed.current = true;
          allRef.current?.click();
          confirmed.current = false;
        }}
      >
        <label className="personnel-replace-confirm">
          {uiText("Gõ {0} để xác nhận", [REPLACE_PHRASE])}
          <input
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            autoComplete="off"
          />
        </label>
      </ConfirmDialog>
    </>
  );
}
