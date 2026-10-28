"use client";
import { useActionState } from "react";
import { requestPasswordRecovery } from "@/app/password/actions";
import { useLanguage } from "@/components/i18n/language-provider";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { LocalizedText } from "@/components/i18n/language-provider";

export function ForgotPasswordForm() {
  const { text: uiText } = useLanguage();

  const [state, action, pending] = useActionState(
    requestPasswordRecovery,
    null,
  );
  return (
    <form action={action} className="login-form">
      <div className="flex justify-end">
        <LanguageSwitcher />
      </div>
      <label>
        {uiText("Email đăng nhập")}
        <input name="email" type="email" required />
      </label>
      {state ? (
        <p className="action-feedback success">
          <LocalizedText text={state.message ?? ""} />
        </p>
      ) : null}
      <button className="button button-primary" disabled={pending}>
        {uiText("Gửi hướng dẫn")}
      </button>
    </form>
  );
}
