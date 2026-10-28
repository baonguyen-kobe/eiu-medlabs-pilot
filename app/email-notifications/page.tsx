import { redirect } from "next/navigation";
import { setEmailDeliveryMode } from "@/app/email-notifications/actions";
import { EmailNotificationTable } from "@/components/email-notification-table";
import { WorkspaceShell } from "@/components/workspace-shell";
import { PaginationLinks } from "@/components/pagination-links";
import { getEmailTestRecipient } from "@/lib/email-notifications";
import { normalizePage, paginationRange } from "@/lib/pagination";
import { createAdminClient } from "@/lib/supabase/admin";
import { getViewer } from "@/lib/viewer";
import { LocalizedText } from "@/components/i18n/language-provider";

export default async function EmailNotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string; page?: string }>;
}) {
  const query = await searchParams;
  const viewer = await getViewer();
  if (!viewer.canManageEmailNotifications) {
    redirect("/dashboard");
  }
  const admin = createAdminClient();
  const { data: deliverySettings } = await admin
    .from("email_delivery_settings")
    .select("delivery_mode,updated_at")
    .eq("setting_key", "primary")
    .maybeSingle();
  const deliveryMode: "off" | "test" | "live" =
    deliverySettings?.delivery_mode === "live" ||
    deliverySettings?.delivery_mode === "test"
      ? deliverySettings.delivery_mode
      : "off";
  const isAdmin = viewer.roles.includes("admin");
  const testRecipient = isAdmin ? getEmailTestRecipient() : null;
  const currentPage = normalizePage(query.page);
  const { from, to } = paginationRange(currentPage);
  const { data: notifications, count } = await admin
    .from("email_notifications")
    .select(
      "id,notification_type,recipient_email,subject,status,attempts,last_error,created_at,sent_at",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(from, to);

  return (
    <WorkspaceShell
      fullName={viewer.fullName}
      roles={viewer.roles}
      roomTypeCodes={viewer.roomTypes.map(({ code }) => code)}
      allowBasicMedicalAccess={viewer.allowBasicMedicalAccess}
      canImportSchedules={viewer.canImportSchedules}
      canManagePersonnel={viewer.canManagePersonnel}
      canManageEmailNotifications={viewer.canManageEmailNotifications}
      title={<LocalizedText text={"Email thông báo"} />}
      description={
        deliveryMode === "off" ? (
          <LocalizedText
            text={
              "Hệ thống đang tắt gửi email. Thông báo mới chỉ được ghi nhận và không gọi Apps Script."
            }
          />
        ) : deliveryMode === "test" ? (
          isAdmin ? (
            <LocalizedText
              text="Chế độ kiểm thử; email thực tế chỉ gửi đến {0}."
              values={[testRecipient]}
            />
          ) : (
            <LocalizedText
              text={
                "Chế độ kiểm thử đang hoạt động; người nhận gốc không nhận email."
              }
            />
          )
        ) : (
          <LocalizedText
            text={
              "Lịch sử email thông báo. Email thất bại chỉ được gửi lại khi Admin hoặc Chuyên viên bấm Gửi lại."
            }
          />
        )
      }
    >
      {query.notice ? (
        <p className="action-feedback success">
          <LocalizedText text={query.notice} />
        </p>
      ) : null}
      {query.error ? (
        <p className="action-feedback error">
          <LocalizedText text={query.error} />
        </p>
      ) : null}
      <section className="data-panel email-delivery-mode-panel">
        <div>
          <strong>
            <LocalizedText text={"Chế độ hiện tại:"} />{" "}
            {deliveryMode === "off" ? (
              <LocalizedText text={"Tắt gửi"} />
            ) : deliveryMode === "test" ? (
              <LocalizedText text={"Kiểm thử"} />
            ) : (
              <LocalizedText text={"Gửi thật"} />
            )}
          </strong>
          <p>
            {deliveryMode === "off" ? (
              <LocalizedText
                text={
                  "Không gửi email đến người nhận gốc hoặc email kiểm thử. Email bị bỏ qua sẽ không được gửi dồn khi bật lại."
                }
              />
            ) : deliveryMode === "test" ? (
              isAdmin ? (
                <LocalizedText
                  text="Người nhận gốc không nhận email. Toàn bộ bản kiểm thử chỉ gửi đến {0} để Admin kiểm tra nội dung."
                  values={[testRecipient]}
                />
              ) : (
                <LocalizedText
                  text={
                    "Người nhận gốc không nhận email trong chế độ kiểm thử."
                  }
                />
              )
            ) : (
              <LocalizedText
                text={
                  "Thông báo mới được gửi thật qua Apps Script đến người nhận."
                }
              />
            )}
          </p>
        </div>
        {isAdmin ? (
          <div className="email-delivery-mode-actions">
            {(
              [
                ["off", "Tắt gửi email", "button-outline-danger"],
                ["test", "Bật kiểm thử", "button-secondary"],
                ["live", "Bật gửi email thật", "button-primary"],
              ] as const
            ).map(([mode, label, className]) => (
              <form action={setEmailDeliveryMode} key={mode}>
                <input type="hidden" name="delivery_mode" value={mode} />
                <button
                  className={`button ${className}`}
                  type="submit"
                  disabled={deliveryMode === mode}
                >
                  <LocalizedText text={label} />
                </button>
              </form>
            ))}
          </div>
        ) : null}
      </section>
      <div className="data-panel catalog-data-panel">
        <EmailNotificationTable
          notifications={notifications ?? []}
          isAdmin={isAdmin}
          canRetry={viewer.canManageEmailNotifications}
          deliveryMode={deliveryMode}
        />
        {!notifications?.length ? (
          <p className="panel-empty">
            <LocalizedText text={"Chưa có email thông báo."} />
          </p>
        ) : null}
        <PaginationLinks
          currentPage={currentPage}
          totalItems={count ?? 0}
          pathname="/email-notifications"
        />
      </div>
    </WorkspaceShell>
  );
}
