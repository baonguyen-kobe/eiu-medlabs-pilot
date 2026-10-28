import { PasswordChangeForm } from "@/components/password-change-form";
import { LocalizedText } from "@/components/i18n/language-provider";

export default function ResetPasswordPage() {
  return (
    <main className="login-page">
      <section className="login-card">
        <h1>
          <LocalizedText text={"Đặt lại mật khẩu"} />
        </h1>
        <PasswordChangeForm reason="password_recovered" />
      </section>
    </main>
  );
}
