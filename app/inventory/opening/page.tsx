import React from "react";
import { requireInventoryViewer } from "@/lib/inventory/auth";
import { OpeningForm } from "@/components/inventory/opening-form";
import { InventoryPageHeader as PageHeader } from "@/components/inventory/inventory-page-header";
import { AlertTriangle } from "@/components/icons";
import { LocalizedText } from "@/components/i18n/language-provider";

export default async function OpeningPage() {
  const viewer = await requireInventoryViewer();

  // Explicit permission-denied surface for Staff (no generic DB loading error)
  if (!viewer.isAdmin) {
    return (
      <div className="space-y-6">
        <PageHeader
          title={
            <LocalizedText
              text={"Khởi tạo Số dư đầu kỳ / Opening Balance (Admin Only)"}
            />
          }
          description={
            <LocalizedText
              text={
                "Nghiệp vụ xác nhận số dư kiểm kê ban đầu có lưu vết pháp lý dành riêng cho Quản trị viên"
              }
            />
          }
        />
        <div
          role="alert"
          aria-live="polite"
          className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200 shadow-xs"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle
              className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5"
              size={20}
            />
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-amber-900 dark:text-amber-100">
                <LocalizedText
                  text={
                    "Quyền truy cập bị từ chối / Access Denied (Admin Only)"
                  }
                />
              </h3>
              <p className="text-xs text-amber-800 dark:text-amber-200 leading-relaxed">
                <LocalizedText
                  text={
                    "Nghiệp vụ khởi tạo số dư đầu kỳ (Opening Balance) chỉ dành riêng cho tài khoản có vai trò Quản trị viên (Admin). Bạn hiện đang đăng nhập với quyền Nhân viên (Staff)."
                  }
                />
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <LocalizedText
            text={"Khởi tạo Số dư đầu kỳ / Opening Balance (Admin Only)"}
          />
        }
        description={
          <LocalizedText
            text={
              "Nghiệp vụ xác nhận số dư kiểm kê ban đầu có lưu vết pháp lý dành riêng cho Quản trị viên"
            }
          />
        }
      />

      <OpeningForm />
    </div>
  );
}
