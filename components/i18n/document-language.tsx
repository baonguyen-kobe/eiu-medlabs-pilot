"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useLanguage } from "./language-provider";

const pageTitles: Readonly<Record<string, string>> = {
  "/login": "Đăng nhập",
  "/schedule-entry/new": "Tạo lịch Skills lab",
  "/schedule-entry/import": "Import lịch Skills lab",
  "/basic-medical/new": "Tạo lịch Y cơ sở",
  "/equipment/import": "Import Phiếu thiết bị",
};

export function DocumentLanguage() {
  const pathname = usePathname();
  const { text, language } = useLanguage();
  useEffect(() => {
    document.documentElement.lang = language;
    const title = pageTitles[pathname];
    document.title = title
      ? `${text(title)} · MedLabs Calendar`
      : "MedLabs Calendar";
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute(
        "content",
        text("Đăng ký phòng học và quản lý lịch trực kho"),
      );
  }, [pathname, language, text]);
  return null;
}
