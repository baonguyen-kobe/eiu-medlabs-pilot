"use client";

import { useEffect } from "react";
import { AlertTriangle } from "@/components/icons";
import { useLanguage } from "@/components/i18n/language-provider";

export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const { text } = useLanguage();

  useEffect(() => {
    console.error("Page load failed:", error);
  }, [error]);

  return (
    <main className="p-8 max-w-2xl mx-auto my-12 bg-white rounded-2xl border border-red-200 space-y-4">
      <AlertTriangle size={24} className="text-red-600" />
      <h1 className="text-base font-bold text-slate-900">
        {text("Không tải được trang này")}
      </h1>
      <p className="text-sm text-slate-600">
        {text(
          "Dữ liệu chưa được hiển thị vì hệ thống gặp lỗi. Không có nghĩa là danh sách đang trống.",
        )}
      </p>
      <button
        type="button"
        className="button button-primary"
        onClick={() => retry()}
      >
        {text("Thử lại / Try Again")}
      </button>
    </main>
  );
}
