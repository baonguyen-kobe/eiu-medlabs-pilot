"use client";

import { useMemo, useState, useTransition } from "react";
import {
  changePersonnelPasswordByRoot,
  reconcilePersonnelPasswordOperation,
  resetPersonnelPassword,
  savePersonnelChanges,
  setPersonnelEmailNotificationCapability,
  type SavePersonnelResult,
} from "@/app/admin/actions";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { getNameInitials } from "@/lib/person-name";
import type { AppRole } from "@/lib/viewer";
import { BASIC_MEDICAL_ROOM_TYPE_ID } from "@/lib/room-types";
import { useLanguage } from "@/components/i18n/language-provider";
import { LocalizedText } from "@/components/i18n/language-provider";

export type PersonnelListItem = {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  title: string | null;
  is_active: boolean;
  can_import_schedules: boolean;
  allow_basic_medical_access: boolean;
  can_manage_email_notifications?: boolean;
  access_version: number;
  roles: AppRole[];
  room_type_ids: string[];
  email_room_type_ids: string[];
  is_root_administrator: boolean;
  is_security_principal: boolean;
  is_current_admin: boolean;
  can_edit_security: boolean;
  password_capable?: boolean;
};

type RoomType = { id: string; name: string; code: string };
type PasswordReconciliationItem = {
  id: string;
  correlation_id: string;
  action: string;
  status: string;
  created_at: string;
  target: { full_name: string; email: string } | null;
};

type PersonnelConfirmation =
  | "discard"
  | "reset-password"
  | "change-password"
  | "grant-admin"
  | "deactivate";

const roleLabels: Record<AppRole, string> = {
  admin: "Quản trị viên",
  staff: "Chuyên viên",
  lecturer: "Giảng viên",
  teaching_assistant: "Trợ giảng",
  viewer: "Người xem",
};

function clone(item: PersonnelListItem): PersonnelListItem {
  return {
    ...item,
    roles: [...item.roles],
    room_type_ids: [...item.room_type_ids],
    email_room_type_ids: [...item.email_room_type_ids],
  };
}

export function PersonnelManagementList({
  initialItems,
  roomTypes,
  viewerId,
  viewerIsRoot,
  passwordReconciliationItems = [],
}: {
  initialItems: PersonnelListItem[];
  roomTypes: RoomType[];
  viewerId: string;
  viewerIsRoot: boolean;
  passwordReconciliationItems?: PasswordReconciliationItem[];
}) {
  const { text: uiText } = useLanguage();

  const [items, setItems] = useState(initialItems);
  const [original, setOriginal] = useState<PersonnelListItem | null>(null);
  const [draft, setDraft] = useState<PersonnelListItem | null>(null);
  const [result, setResult] = useState<SavePersonnelResult | null>(null);
  const [passwordDraft, setPasswordDraft] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [emailCapability, setEmailCapability] = useState(false);
  const [reconcilingId, setReconcilingId] = useState<string | null>(null);
  const [confirmation, setConfirmation] =
    useState<PersonnelConfirmation | null>(null);
  const [pending, startTransition] = useTransition();
  const dirty = useMemo(
    () =>
      Boolean(
        original && draft && JSON.stringify(original) !== JSON.stringify(draft),
      ),
    [draft, original],
  );
  // Keep production's save boundary: the email capability is persisted only
  // when an existing Personnel draft is saved.
  const hasChanges = dirty;
  const basicMedicalEligible = Boolean(
    draft?.roles.some((role) =>
      ["lecturer", "teaching_assistant"].includes(role),
    ) && draft.room_type_ids.includes(BASIC_MEDICAL_ROOM_TYPE_ID),
  );

  function open(item: PersonnelListItem) {
    setOriginal(clone(item));
    setDraft(clone(item));
    setEmailCapability(Boolean(item.can_manage_email_notifications));
    setResult(null);
  }

  function closeDrawer() {
    setOriginal(null);
    setDraft(null);
    setResult(null);
    setPasswordDraft("");
    setPasswordConfirmation("");
  }

  function close() {
    if (pending) return;
    if (hasChanges) {
      setConfirmation("discard");
      return;
    }
    closeDrawer();
  }

  function reconcilePasswordOperation(operationId: string) {
    setResult(null);
    setReconcilingId(operationId);
    startTransition(async () => {
      try {
        await reconcilePersonnelPasswordOperation(operationId);
        setResult({ ok: true, message: "Đã đối soát thao tác mật khẩu." });
      } catch {
        setResult({
          ok: false,
          message: "Không thể đối soát thao tác mật khẩu.",
        });
      } finally {
        setReconcilingId(null);
      }
    });
  }

  function resetPassword() {
    if (!draft?.password_capable || pending) return;
    setConfirmation("reset-password");
  }

  function performPasswordReset() {
    if (!draft?.password_capable || pending) return;
    startTransition(async () => {
      try {
        const outcome = await resetPersonnelPassword(draft.id);
        if (outcome?.outcome === "reconciliation_pending") {
          setResult({
            ok: false,
            message:
              "Không xác định được kết quả cập nhật Auth. Hệ thống đã ghi nhận để đối soát; không thử lại mật khẩu ngay.",
          });
          return;
        }
        setResult({
          ok: true,
          message:
            "Đã đặt lại mật khẩu tạm thời và yêu cầu đổi mật khẩu sau khi đăng nhập.",
        });
      } catch (error) {
        setResult({
          ok: false,
          message:
            error instanceof Error &&
            error.message.includes("AUTH_CHANGED_RECONCILIATION_REQUIRED")
              ? "Mật khẩu trên Auth có thể đã đổi nhưng lưu hồ sơ chưa hoàn tất. Đã ghi nhận đối soát; không thử lại mật khẩu này."
              : error instanceof Error &&
                  error.message.includes("AUTH_FAILED_RECONCILIATION_REQUIRED")
                ? "Auth báo thất bại; trạng thái lưu cần đối soát trước khi thử lại."
                : error instanceof Error &&
                    error.message.includes("AUTH_OUTCOME_UNCHANGED")
                  ? "Không nhận được phản hồi từ Auth; đối soát đã xác nhận mật khẩu chưa đổi và có thể thử lại."
                  : "Auth không đổi mật khẩu; không có thay đổi mật khẩu nào được xác nhận.",
        });
      }
    });
  }

  function changePasswordAsRoot() {
    if (
      !draft ||
      !viewerIsRoot ||
      !draft.password_capable ||
      pending ||
      passwordDraft.length < 6 ||
      passwordDraft !== passwordConfirmation
    )
      return;
    setConfirmation("change-password");
  }

  function performRootPasswordChange() {
    if (
      !draft ||
      !viewerIsRoot ||
      !draft.password_capable ||
      pending ||
      passwordDraft.length < 6 ||
      passwordDraft !== passwordConfirmation
    )
      return;
    startTransition(async () => {
      try {
        const outcome = await changePersonnelPasswordByRoot(
          draft.id,
          passwordDraft,
          passwordConfirmation,
        );
        if (outcome?.outcome === "reconciliation_pending") {
          setResult({
            ok: false,
            message:
              "Không xác định được kết quả cập nhật Auth. Hệ thống đã ghi nhận để đối soát; không thử lại mật khẩu ngay.",
          });
          return;
        }
        setPasswordDraft("");
        setPasswordConfirmation("");
        setResult({ ok: true, message: "Đã đổi mật khẩu." });
      } catch (error) {
        setResult({
          ok: false,
          message:
            error instanceof Error &&
            error.message.includes("AUTH_CHANGED_RECONCILIATION_REQUIRED")
              ? "Mật khẩu trên Auth có thể đã đổi nhưng lưu hồ sơ chưa hoàn tất. Đã ghi nhận đối soát; không nhập lại mật khẩu này."
              : error instanceof Error &&
                  error.message.includes("AUTH_FAILED_RECONCILIATION_REQUIRED")
                ? "Auth báo thất bại; trạng thái lưu cần đối soát trước khi thử lại."
                : error instanceof Error &&
                    error.message.includes("AUTH_OUTCOME_UNCHANGED")
                  ? "Không nhận được phản hồi từ Auth; đối soát đã xác nhận mật khẩu chưa đổi và có thể thử lại."
                  : "Auth không đổi mật khẩu; không có thay đổi mật khẩu nào được xác nhận.",
        });
      }
    });
  }

  function toggleRole(role: AppRole) {
    if (!draft) return;
    if (role === "viewer") {
      const selecting = !draft.roles.includes("viewer");
      setDraft({
        ...draft,
        roles: selecting ? ["viewer"] : [],
        can_import_schedules: selecting ? false : draft.can_import_schedules,
        allow_basic_medical_access: selecting
          ? false
          : draft.allow_basic_medical_access,
      });
      return;
    }
    const next = draft.roles.includes(role)
      ? draft.roles.filter((value) => value !== role)
      : [...draft.roles.filter((value) => value !== "viewer"), role];
    const canImportRole = next.some((value) =>
      ["staff", "lecturer", "teaching_assistant"].includes(value),
    );
    setDraft({
      ...draft,
      roles: next,
      email_room_type_ids: [],
      can_import_schedules: canImportRole ? draft.can_import_schedules : false,
      allow_basic_medical_access:
        canImportRole &&
        next.some((value) =>
          ["lecturer", "teaching_assistant"].includes(value),
        ) &&
        draft.room_type_ids.includes(BASIC_MEDICAL_ROOM_TYPE_ID)
          ? draft.allow_basic_medical_access
          : false,
    });
  }

  function submit() {
    if (!draft || pending || !draft.can_edit_security) return;
    if (requiresGrantAdminConfirmation()) {
      setConfirmation("grant-admin");
      return;
    }
    if (requiresDeactivationConfirmation()) {
      setConfirmation("deactivate");
      return;
    }
    performSubmit();
  }

  function requiresGrantAdminConfirmation() {
    return Boolean(
      draft &&
      !viewerIsRoot &&
      !original?.is_current_admin &&
      draft.roles.includes("admin"),
    );
  }

  function requiresDeactivationConfirmation() {
    return Boolean(draft && !draft.is_active && original?.is_active);
  }

  function performSubmit() {
    if (!draft || pending || !draft.can_edit_security) return;
    const formData = new FormData();
    formData.set("id", draft.id);
    formData.set("email", draft.email);
    formData.set("full_name", draft.full_name);
    formData.set("phone", draft.phone ?? "");
    formData.set("title", draft.title ?? "");
    formData.set("access_version", String(draft.access_version));
    formData.set("can_import_schedules", String(draft.can_import_schedules));
    formData.set(
      "allow_basic_medical_access",
      String(draft.allow_basic_medical_access),
    );
    formData.set("is_active", String(draft.is_active));
    draft.roles.forEach((role) => formData.append("roles", role));
    draft.room_type_ids.forEach((id) => formData.append("room_type_ids", id));
    draft.email_room_type_ids.forEach((id) =>
      formData.append("email_room_type_ids", id),
    );
    startTransition(async () => {
      const response = await savePersonnelChanges(formData);
      setResult(response);
      if (!response.ok || !response.personnel) return;
      const saved = response.personnel as unknown as PersonnelListItem;
      if (saved.roles.includes("staff")) {
        try {
          saved.access_version = await setPersonnelEmailNotificationCapability(
            saved.id,
            emailCapability,
          );
          saved.can_manage_email_notifications = emailCapability;
        } catch {
          setResult({
            ok: false,
            message: "Không thể cập nhật quyền Quản lý Email Notifications.",
          });
          return;
        }
      }
      setItems((current) =>
        current.map((item) => (item.id === saved.id ? clone(saved) : item)),
      );
      setOriginal(clone(saved));
      setDraft(clone(saved));
    });
  }

  const confirmationCopy = {
    discard: {
      title: "Bỏ thay đổi chưa lưu?",
      description:
        "Các thay đổi trong biểu mẫu Nhân sự sẽ bị bỏ và không được lưu.",
      confirmLabel: "Bỏ thay đổi",
      tone: "danger" as const,
    },
    "reset-password": {
      title: "Đặt lại mật khẩu?",
      description: draft
        ? `Mật khẩu của ${draft.full_name} sẽ được đặt thành email đăng nhập và buộc đổi sau khi đăng nhập.`
        : "Mật khẩu sẽ được đặt lại theo chính sách hiện hành.",
      confirmLabel: "Đặt lại mật khẩu",
      tone: "danger" as const,
    },
    "change-password": {
      title: "Đổi mật khẩu với quyền Root?",
      description: draft
        ? `Mật khẩu mới sẽ được áp dụng cho ${draft.full_name}. Hành động này được ghi nhận bảo mật.`
        : "Mật khẩu mới sẽ được áp dụng cho nhân sự đã chọn.",
      confirmLabel: "Đổi mật khẩu",
      tone: "danger" as const,
    },
    "grant-admin": {
      title: "Cấp quyền Quản trị viên?",
      description: draft
        ? `Sau khi lưu, chỉ Root Administrator mới có thể thay đổi quyền hoặc khóa tài khoản ${draft.full_name}.`
        : "Quyền Quản trị viên sẽ được cấp sau khi lưu.",
      confirmLabel: "Cấp quyền Admin",
      tone: "danger" as const,
    },
    deactivate: {
      title: "Khóa tài khoản?",
      description: draft
        ? `${draft.full_name} sẽ không thể đăng nhập. Dữ liệu và lịch sử hoạt động vẫn được giữ lại.`
        : "Người dùng sẽ không thể đăng nhập, nhưng dữ liệu và lịch sử vẫn được giữ lại.",
      confirmLabel: "Khóa tài khoản",
      tone: "danger" as const,
    },
  } satisfies Record<
    PersonnelConfirmation,
    { title: string; description: string; confirmLabel: string; tone: "danger" }
  >;

  function confirmPersonnelAction() {
    const action = confirmation;
    if (!action || pending) return;
    setConfirmation(null);
    if (action === "discard") return closeDrawer();
    if (action === "reset-password") return performPasswordReset();
    if (action === "change-password") return performRootPasswordChange();
    if (action === "grant-admin" && requiresDeactivationConfirmation()) {
      setConfirmation("deactivate");
      return;
    }
    performSubmit();
  }

  const passwordSection = draft ? (
    draft.password_capable ? (
      <fieldset
        className="personnel-password-section"
        disabled={pending || !draft.can_edit_security}
      >
        <legend>{uiText("Mật khẩu / Bảo mật")}</legend>
        <button
          className="button button-secondary"
          type="button"
          onClick={resetPassword}
        >
          {uiText("Đặt lại mật khẩu")}
        </button>
        {viewerIsRoot ? (
          <>
            <label>
              {uiText("Mật khẩu mới")}
              <input
                type="password"
                value={passwordDraft}
                minLength={6}
                onChange={(event) => setPasswordDraft(event.target.value)}
              />
            </label>
            <label>
              {uiText("Xác nhận mật khẩu mới")}
              <input
                type="password"
                value={passwordConfirmation}
                minLength={6}
                onChange={(event) =>
                  setPasswordConfirmation(event.target.value)
                }
              />
            </label>
            <button
              className="button button-secondary"
              type="button"
              onClick={changePasswordAsRoot}
            >
              {uiText("Đổi mật khẩu")}
            </button>
          </>
        ) : null}
      </fieldset>
    ) : (
      <section
        className="personnel-password-section"
        aria-label={uiText("Mật khẩu / Bảo mật")}
      >
        <h3>{uiText("Mật khẩu / Bảo mật")}</h3>
        <p className="field-note">
          {uiText("Tài khoản Google-only không có thao tác mật khẩu.")}
        </p>
      </section>
    )
  ) : null;

  return (
    <>
      {viewerIsRoot && passwordReconciliationItems.length ? (
        <section
          className="data-panel"
          aria-label={uiText("Đối soát mật khẩu")}
        >
          <h2>{uiText("Thao tác mật khẩu cần đối soát")}</h2>
          <div className="responsive-table">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{uiText("Mã thao tác")}</th>
                  <th>{uiText("Nhân sự")}</th>
                  <th>{uiText("Loại")}</th>
                  <th>{uiText("Trạng thái")}</th>
                  <th>{uiText("Thời điểm")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {passwordReconciliationItems.map((operation) => (
                  <tr key={operation.id}>
                    <td className="mono">
                      {operation.correlation_id.slice(0, 8)}
                    </td>
                    <td>{operation.target?.full_name ?? uiText("Nhân sự")}</td>
                    <td>{operation.action}</td>
                    <td>{operation.status}</td>
                    <td>
                      {new Intl.DateTimeFormat("vi-VN", {
                        dateStyle: "short",
                        timeStyle: "short",
                      }).format(new Date(operation.created_at))}
                    </td>
                    <td>
                      <button
                        className="button button-secondary"
                        disabled={pending || reconcilingId === operation.id}
                        onClick={() => reconcilePasswordOperation(operation.id)}
                      >
                        {reconcilingId === operation.id
                          ? uiText("Đang đối soát…")
                          : uiText("Đối soát")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
      <div className="personnel-table-wrap">
        <table className="personnel-table">
          <thead>
            <tr>
              <th>{uiText("Mã")}</th>
              <th>{uiText("Họ và tên")}</th>
              <th>{uiText("Email")}</th>
              <th>{uiText("Vai trò")}</th>
              <th>{uiText("Quyền bổ sung")}</th>
              <th>{uiText("Phạm vi")}</th>
              <th>{uiText("Trạng thái")}</th>
              <th>{uiText("Thao tác")}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td className="personnel-code mono">
                  {getNameInitials(item.full_name)}
                </td>
                <td>
                  <span className="personnel-name">
                    <strong>{item.full_name}</strong>
                    {item.title ? <small>{item.title}</small> : null}
                  </span>
                </td>
                <td className="personnel-email">{item.email}</td>
                <td>
                  <span className="personnel-badges">
                    {item.roles.map((role) => (
                      <span className="role-chip selected" key={role}>
                        {uiText(roleLabels[role])}
                      </span>
                    ))}
                  </span>
                </td>
                <td>
                  <span className="personnel-badges">
                    {item.is_root_administrator ? (
                      <span className="permission-badge">
                        {uiText("Root Administrator")}
                      </span>
                    ) : null}
                    {item.is_security_principal &&
                    !item.is_root_administrator ? (
                      <span className="permission-badge">
                        {uiText("Quản lý nhân sự")}
                      </span>
                    ) : null}
                    {item.can_import_schedules ? (
                      <span className="permission-badge">
                        {uiText("Nhập lịch")}
                      </span>
                    ) : null}
                    {!item.is_root_administrator &&
                    !item.is_security_principal &&
                    !item.can_import_schedules
                      ? "—"
                      : null}
                  </span>
                </td>
                <td>
                  <span className="personnel-badges">
                    {roomTypes
                      .filter((roomType) =>
                        item.room_type_ids.includes(roomType.id),
                      )
                      .map((roomType) => (
                        <span className="scope-badge" key={roomType.id}>
                          {roomType.name}
                        </span>
                      ))}
                  </span>
                </td>
                <td>
                  <span
                    className={`status-pill ${item.is_active ? "is-active" : ""}`}
                  >
                    {item.is_active ? uiText("Hoạt động") : uiText("Đã khóa")}
                  </span>
                </td>
                <td>
                  <button
                    className="button button-secondary"
                    type="button"
                    onClick={() => open(item)}
                  >
                    {item.can_edit_security ? uiText("Sửa") : uiText("Xem")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {draft ? (
        <div
          className="personnel-drawer-backdrop"
          role="presentation"
          onMouseDown={(event) =>
            event.target === event.currentTarget && close()
          }
        >
          <section
            className="personnel-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="personnel-drawer-title"
          >
            <header>
              <div>
                <h2 id="personnel-drawer-title">
                  {uiText("Chỉnh sửa nhân sự")}
                </h2>
                <p>{draft.email}</p>
              </div>
              <button
                aria-label={uiText("Đóng")}
                className="button button-secondary"
                type="button"
                onClick={close}
                disabled={pending}
              >
                {uiText("×")}
              </button>
            </header>
            <div className="personnel-drawer-body">
              {result ? (
                <p
                  className={`action-feedback ${result.ok ? "success" : "error"}`}
                  role="status"
                >
                  <LocalizedText text={result.message ?? ""} />
                </p>
              ) : null}
              {!draft.can_edit_security ? (
                <p className="action-feedback">
                  {draft.is_root_administrator
                    ? uiText(
                        "Đây là tài khoản Root Administrator của hệ thống. Tài khoản này không thể bị khóa hoặc gỡ quyền Admin.",
                      )
                    : uiText(
                        "Chỉ Root Administrator được thay đổi tài khoản đang có quyền Admin.",
                      )}
                </p>
              ) : null}
              <fieldset disabled={pending || !draft.can_edit_security}>
                <legend>{uiText("Thông tin cơ bản")}</legend>
                <label>
                  {uiText("Họ và tên")}
                  <input
                    value={draft.full_name}
                    onChange={(event) =>
                      setDraft({ ...draft, full_name: event.target.value })
                    }
                  />
                </label>
                <label>
                  {uiText("Email đăng nhập")}
                  <input
                    type="email"
                    value={draft.email}
                    onChange={(event) =>
                      setDraft({ ...draft, email: event.target.value })
                    }
                  />
                </label>
                <p className="field-note">
                  {uiText(
                    "Thay đổi email sẽ thay đổi tên đăng nhập của người dùng.",
                  )}
                </p>
                <label>
                  {uiText("Số điện thoại")}
                  <input
                    value={draft.phone ?? ""}
                    onChange={(event) =>
                      setDraft({ ...draft, phone: event.target.value })
                    }
                  />
                </label>
                <label>
                  {uiText("Chức danh")}
                  <input
                    value={draft.title ?? ""}
                    onChange={(event) =>
                      setDraft({ ...draft, title: event.target.value })
                    }
                  />
                </label>
              </fieldset>

              <fieldset disabled={pending || !draft.can_edit_security}>
                <legend>{uiText("Vai trò chính")}</legend>
                {(Object.keys(roleLabels) as AppRole[]).map((role) => (
                  <label className="check-label" key={role}>
                    <input
                      type="checkbox"
                      checked={draft.roles.includes(role)}
                      onChange={() => toggleRole(role)}
                      disabled={draft.id === viewerId && role === "admin"}
                    />
                    {uiText(roleLabels[role])}
                  </label>
                ))}
                {draft.roles.includes("viewer") ? (
                  <p className="field-note">
                    {uiText(
                      "Người xem chỉ có quyền đọc và không thể kết hợp với vai trò khác.",
                    )}
                  </p>
                ) : null}
              </fieldset>

              <fieldset disabled={pending || !draft.can_edit_security}>
                <legend>{uiText("Quyền bổ sung")}</legend>
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={draft.can_import_schedules}
                    disabled={
                      !draft.roles.some((role) =>
                        ["staff", "lecturer", "teaching_assistant"].includes(
                          role,
                        ),
                      )
                    }
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        can_import_schedules: event.target.checked,
                      })
                    }
                  />
                  {uiText("Cho phép nhập lịch")}
                </label>
                {draft.roles.includes("staff") ? (
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={emailCapability}
                      onChange={(event) =>
                        setEmailCapability(event.target.checked)
                      }
                    />
                    {uiText("Quản lý Email Notifications")}
                  </label>
                ) : null}
                {!draft.roles.some((role) =>
                  ["staff", "lecturer", "teaching_assistant"].includes(role),
                ) ? (
                  <p className="field-note">
                    {uiText(
                      "Quyền nhập lịch chỉ áp dụng cho Chuyên viên, Giảng viên hoặc Trợ giảng.",
                    )}
                  </p>
                ) : null}
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={draft.allow_basic_medical_access}
                    disabled={!basicMedicalEligible}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        allow_basic_medical_access: event.target.checked,
                      })
                    }
                  />
                  {uiText("Cho phép tạo lịch Y cơ sở")}
                </label>
                {!basicMedicalEligible ? (
                  <p className="field-note">
                    {uiText(
                      "Chỉ Giảng viên hoặc Trợ giảng thuộc phạm vi Y cơ sở mới có thể nhận quyền này.",
                    )}
                  </p>
                ) : null}
              </fieldset>

              <fieldset disabled={pending || !draft.can_edit_security}>
                <legend>{uiText("Phạm vi phụ trách")}</legend>
                {roomTypes.map((roomType) => {
                  const assigned = draft.room_type_ids.includes(roomType.id);
                  return (
                    <div className="person-room-scope" key={roomType.id}>
                      <label className="check-label">
                        <input
                          type="checkbox"
                          checked={assigned}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              room_type_ids: event.target.checked
                                ? [...draft.room_type_ids, roomType.id]
                                : draft.room_type_ids.filter(
                                    (id) => id !== roomType.id,
                                  ),
                              email_room_type_ids: event.target.checked
                                ? draft.email_room_type_ids
                                : draft.email_room_type_ids.filter(
                                    (id) => id !== roomType.id,
                                  ),
                              allow_basic_medical_access:
                                !event.target.checked &&
                                roomType.id === BASIC_MEDICAL_ROOM_TYPE_ID
                                  ? false
                                  : draft.allow_basic_medical_access,
                            })
                          }
                        />
                        {roomType.name}
                      </label>
                      {draft.roles.includes("viewer") && assigned ? (
                        <label className="check-label">
                          <input
                            type="checkbox"
                            checked={draft.email_room_type_ids.includes(
                              roomType.id,
                            )}
                            onChange={(event) =>
                              setDraft({
                                ...draft,
                                email_room_type_ids: event.target.checked
                                  ? [...draft.email_room_type_ids, roomType.id]
                                  : draft.email_room_type_ids.filter(
                                      (id) => id !== roomType.id,
                                    ),
                              })
                            }
                          />
                          {uiText("Nhận email lịch của loại phòng này")}
                        </label>
                      ) : null}
                    </div>
                  );
                })}
              </fieldset>

              <fieldset disabled={pending || !draft.can_edit_security}>
                <legend>{uiText("Trạng thái")}</legend>
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={draft.is_active}
                    disabled={draft.id === viewerId && draft.is_active}
                    onChange={(event) =>
                      setDraft({ ...draft, is_active: event.target.checked })
                    }
                  />
                  {uiText("Đang hoạt động")}
                </label>
              </fieldset>
              {passwordSection}
            </div>
            <footer>
              <span>
                {hasChanges
                  ? uiText("Có thay đổi chưa lưu")
                  : result?.ok
                    ? uiText("Đã lưu")
                    : ""}
              </span>
              <button
                className="button button-secondary"
                type="button"
                onClick={close}
                disabled={pending}
              >
                {uiText("Hủy")}
              </button>
              <button
                className="button button-primary"
                type="button"
                onClick={submit}
                disabled={
                  pending ||
                  !draft.can_edit_security ||
                  !hasChanges ||
                  draft.roles.length === 0 ||
                  draft.room_type_ids.length === 0
                }
              >
                {pending ? uiText("Đang lưu…") : uiText("Lưu thay đổi")}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
      {confirmation ? (
        <ConfirmDialog
          open
          title={confirmationCopy[confirmation].title}
          description={confirmationCopy[confirmation].description}
          confirmLabel={confirmationCopy[confirmation].confirmLabel}
          tone={confirmationCopy[confirmation].tone}
          pending={pending}
          onCancel={() => setConfirmation(null)}
          onConfirm={confirmPersonnelAction}
        />
      ) : null}
    </>
  );
}
