"use client";

import { useEffect, useRef, useState } from "react";
import { BASIC_MEDICAL_ROOM_TYPE_ID } from "@/lib/room-types";
import { useLanguage } from "@/components/i18n/language-provider";

export function PersonnelBasicMedicalPermissionField() {
  const { text: uiText } = useLanguage();

  const containerRef = useRef<HTMLLabelElement>(null);
  const [eligible, setEligible] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const form = containerRef.current?.closest("form");
    if (!form) return;
    const sync = () => {
      const hasEligibleRole = ["lecturer", "teaching_assistant"].some((role) =>
        Boolean(
          form.querySelector<HTMLInputElement>(
            `input[name="roles"][value="${role}"]:checked`,
          ),
        ),
      );
      const hasScope = Boolean(
        form.querySelector<HTMLInputElement>(
          `input[name="room_type_ids"][value="${BASIC_MEDICAL_ROOM_TYPE_ID}"]:checked`,
        ),
      );
      const nextEligible = hasEligibleRole && hasScope;
      setEligible(nextEligible);
      if (!nextEligible) setChecked(false);
    };
    sync();
    form.addEventListener("change", sync);
    return () => form.removeEventListener("change", sync);
  }, []);

  return (
    <>
      <label className="check-label" ref={containerRef}>
        <input
          checked={checked}
          disabled={!eligible}
          name="allow_basic_medical_access"
          onChange={(event) => setChecked(event.target.checked)}
          type="checkbox"
          value="true"
        />
        {uiText("Cho phép tạo lịch Y cơ sở")}
      </label>
      {!eligible ? (
        <small>
          {uiText("Chỉ dành cho Giảng viên/Trợ giảng có loại phòng Y cơ sở.")}
        </small>
      ) : null}
    </>
  );
}
