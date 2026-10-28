import Link from "next/link";
import { ForgotPasswordForm } from "@/components/forgot-password-form";
import { LocalizedText } from "@/components/i18n/language-provider";

export default function ForgotPasswordPage() {
  return (
    <main className="login-page">
      <section className="login-card">
        <h1>
          <LocalizedText text={"Quên mật khẩu"} />
        </h1>
        <ForgotPasswordForm />
        <Link href="/login">
          <LocalizedText text={"Quay lại đăng nhập"} />
        </Link>
      </section>
    </main>
  );
}
