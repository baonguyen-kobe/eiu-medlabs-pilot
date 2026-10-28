"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { SearchableCombobox } from "@/components/searchable-combobox";
import { useLanguage } from "@/components/i18n/language-provider";

export type BasicMedicalEquipmentSessionOption = {
  value: string;
  label: string;
  keywords: string;
};

export function BasicMedicalEquipmentSessionSelector({
  sessions,
  mode,
  requestKey,
}: {
  sessions: BasicMedicalEquipmentSessionOption[];
  mode?: "copy";
  requestKey?: string;
}) {
  const { text: uiText } = useLanguage();

  const router = useRouter();
  return (
    <>
      <div className="class-picker-row">
        <label>
          {uiText("Buổi học Y cơ sở *")}
          <SearchableCombobox
            value=""
            options={sessions}
            onChange={(sessionId) => {
              if (!sessionId) return;
              const query = new URLSearchParams({ session: sessionId });
              if (mode) query.set("mode", mode);
              if (requestKey) query.set("request", requestKey);
              router.push(`/basic-medical/equipment-requests?${query}`);
            }}
            required
            ariaLabel={uiText("Buổi học Y cơ sở")}
            placeholder={uiText("Chọn buổi học theo ngày, giờ và phòng")}
          />
        </label>
        <Link
          className="button button-secondary create-class-button"
          href="/basic-medical/new"
        >
          {uiText("+ Tạo lịch Y cơ sở")}
        </Link>
      </div>
      {!sessions.length ? (
        <p className="panel-empty">
          {uiText("Không có buổi học Y cơ sở phù hợp để đăng ký thiết bị.")}
        </p>
      ) : null}
    </>
  );
}
