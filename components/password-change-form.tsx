"use client";
import { useActionState } from "react";
import { completePasswordChange } from "@/app/password/actions";
import { useLanguage } from "@/components/i18n/language-provider";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { LocalizedText } from "@/components/i18n/language-provider";

export function PasswordChangeForm({
  reason = "password_changed",
}: {
  reason?: string;
}) {
  const { text: uiText } = useLanguage();

  const [state, action, pending] = useActionState(completePasswordChange, null);
  return (
    <form action={action} className="login-form">
      <div className="flex justify-end">
        <LanguageSwitcher />
      </div>
      <input name="reason" type="hidden" value={reason} />
      <label>
        {uiText("Mật khẩu mới")}
        <input name="password" type="password" minLength={6} required />
      </label>
      <label>
        {uiText("Xác nhận mật khẩu")}
        <input name="confirmation" type="password" minLength={6} required />
      </label>
      {state ? (
        <p
          className={
            state.ok ? "action-feedback success" : "action-feedback error"
          }
        >
          <LocalizedText text={state.message ?? ""} />
        </p>
      ) : null}
      <button className="button button-primary" disabled={pending}>
        {uiText("Cập nhật mật khẩu")}
      </button>
    </form>
  );
}
