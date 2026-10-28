"use client";

import { UploadCloud } from "@/components/icons";
import { useLanguage } from "@/components/i18n/language-provider";

export function PersonnelImportButtons() {
  const { text: uiText } = useLanguage();

  return (
    <>
      <button className="button equipment-import-new" name="mode" value="new">
        <UploadCloud size={17} />
        {uiText(" Import mới")}
      </button>
      <button
        className="button equipment-import-all"
        name="mode"
        value="all"
        onClick={(event) => {
          if (
            !window.confirm(
              "Import tất cả sẽ thay toàn bộ danh sách nhân sự hiện tại, chỉ giữ nguyên tài khoản Quản trị viên. Bạn có chắc muốn tiếp tục?",
            )
          ) {
            event.preventDefault();
          }
        }}
      >
        <UploadCloud size={17} />
        {uiText(" Import tất cả")}
      </button>
    </>
  );
}
