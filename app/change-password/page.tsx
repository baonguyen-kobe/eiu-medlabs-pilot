import { PasswordChangeForm } from "@/components/password-change-form";
import { LocalizedText } from "@/components/i18n/language-provider";

export default function ChangePasswordPage() {
  return (
    <main className="login-page">
      <section className="login-card">
        <h1>
          <LocalizedText text={"Đổi mật khẩu bắt buộc"} />
        </h1>
        <p>
          <LocalizedText text={"Hãy tạo mật khẩu mới để tiếp tục."} />
        </p>
        <PasswordChangeForm />
      </section>
    </main>
  );
}
