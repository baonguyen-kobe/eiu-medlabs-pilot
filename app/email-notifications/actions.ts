"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  getEmailDeliveryMode,
  getEmailTestRecipient,
  retryEmailNotification,
} from "@/lib/email-notifications";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

function resultUrl(kind: "notice" | "error", message: string) {
  return `/email-notifications?${kind}=${encodeURIComponent(message)}`;
}

async function emailManagerContext() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) redirect("/login");
  const [{ data: roles }, { data: profile }] = await Promise.all([
    supabase.from("user_roles").select("role").eq("user_id", userId),
    supabase
      .from("profiles")
      .select("can_manage_email_notifications")
      .eq("id", userId)
      .maybeSingle(),
  ]);
  const isAdmin = (roles ?? []).some(({ role }) => role === "admin");
  const canManage =
    isAdmin ||
    ((roles ?? []).some(({ role }) => role === "staff") &&
      Boolean(profile?.can_manage_email_notifications));
  return { supabase, isAdmin, canManage };
}

export async function retryFailedEmail(formData: FormData) {
  const notificationId = String(formData.get("id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(notificationId)) {
    redirect(resultUrl("error", "Email thông báo không hợp lệ."));
  }
  const { canManage } = await emailManagerContext();
  const deliveryMode = await getEmailDeliveryMode();
  const canRetry = deliveryMode !== "off" && canManage;
  if (!canRetry) {
    redirect(resultUrl("error", "Bạn không có quyền gửi lại email."));
  }

  const sent = await retryEmailNotification(notificationId);
  revalidatePath("/email-notifications");
  redirect(
    sent
      ? resultUrl(
          "notice",
          deliveryMode === "test"
            ? "Đã gửi bản kiểm thử; người nhận gốc không nhận email."
            : "Đã gửi lại email thành công.",
        )
      : resultUrl(
          "error",
          "Không thể gửi lại. Email phải đang ở trạng thái Thất bại.",
        ),
  );
}

export async function setEmailDeliveryMode(formData: FormData) {
  const deliveryMode = String(formData.get("delivery_mode") ?? "");
  if (!["off", "test", "live"].includes(deliveryMode)) {
    redirect(resultUrl("error", "Chế độ gửi email không hợp lệ."));
  }

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) redirect("/login");
  const { data: roleRows } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  if (!(roleRows ?? []).some(({ role }) => role === "admin")) {
    redirect(
      resultUrl("error", "Chỉ Quản trị viên được đổi chế độ gửi email."),
    );
  }

  let testRecipient = "";
  if (deliveryMode === "test") {
    try {
      testRecipient = getEmailTestRecipient();
    } catch {
      redirect(
        resultUrl(
          "error",
          "Chưa cấu hình địa chỉ nhận email kiểm thử (EMAIL_TEST_RECIPIENT); không bật được chế độ kiểm thử.",
        ),
      );
    }
  }

  const { error } = await supabase.rpc("set_email_delivery_mode", {
    target_mode: deliveryMode,
  });
  if (error) {
    redirect(resultUrl("error", "Không thể cập nhật chế độ gửi email."));
  }

  revalidatePath("/email-notifications");
  redirect(
    resultUrl(
      "notice",
      deliveryMode === "off"
        ? "Đã tắt gửi email. Email mới sẽ được ghi nhận nhưng không gửi qua Apps Script."
        : deliveryMode === "test"
          ? `Đã bật chế độ kiểm thử. Email mới chỉ gửi đến ${testRecipient}.`
          : "Đã bật gửi email thật qua Apps Script.",
    ),
  );
}

export async function deleteSelectedEmailNotifications(formData: FormData) {
  const notificationIds = [
    ...new Set(
      formData
        .getAll("notification_ids")
        .map(String)
        .filter((id) => /^[0-9a-f-]{36}$/i.test(id)),
    ),
  ].slice(0, 100);
  if (!notificationIds.length) {
    redirect(resultUrl("error", "Vui lòng chọn ít nhất một email để xóa."));
  }

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) redirect("/login");
  const { data: roleRows } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  if (!(roleRows ?? []).some(({ role }) => role === "admin")) {
    redirect(resultUrl("error", "Chỉ Quản trị viên được xóa email thông báo."));
  }

  const admin = createAdminClient();
  const { data: deletedRows, error } = await admin
    .from("email_notifications")
    .delete()
    .in("id", notificationIds)
    .select("id");
  if (error) {
    redirect(resultUrl("error", "Không thể xóa các email đã chọn."));
  }

  revalidatePath("/email-notifications");
  redirect(
    resultUrl(
      "notice",
      `Đã xóa ${(deletedRows ?? []).length} email thông báo.`,
    ),
  );
}
