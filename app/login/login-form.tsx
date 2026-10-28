"use client";

import { LockKeyhole, Mail } from "@/components/icons";
import Link from "next/link";
import { useActionState, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { login, type LoginState } from "./actions";
import { useLanguage } from "@/components/i18n/language-provider";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";

const initialState: LoginState = {};

export function LoginForm({ oauthError }: { oauthError?: string }) {
  const { text: uiText } = useLanguage();

  const [state, formAction, pending] = useActionState(login, initialState);
  const [googlePending, setGooglePending] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);

  async function signInWithGoogle() {
    setGooglePending(true);
    setGoogleError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=/dashboard`,
        queryParams: {
          hd: "eiu.edu.vn",
          prompt: "select_account",
        },
      },
    });
    if (error) {
      setGoogleError(
        error.message.includes("Unsupported provider")
          ? "Google chưa được cấu hình trong Supabase local."
          : error.message,
      );
      setGooglePending(false);
    }
  }

  return (
    <form className="login-form" action={formAction}>
      <div className="flex justify-end">
        <LanguageSwitcher />
      </div>
      <header className="login-form-heading">
        <p className="login-faculty-title">
          {uiText("KHOA KHOA HỌC SỨC KHỎE")}
        </p>
        <h2>{uiText("MedLabs Calendar")}</h2>
        <p className="login-subtitle">
          <strong>{uiText("Quản lý nội bộ")}</strong>
          <span>{uiText("Phòng thí nghiệm - Phòng thực hành kỹ năng")}</span>
        </p>
      </header>
      <label>
        {uiText("ID hoặc email")}
        <span className="input-with-icon">
          <Mail size={20} />
          <input name="email" type="text" autoComplete="username" required />
        </span>
      </label>
      <label>
        {uiText("Mật khẩu")}
        <span className="input-with-icon">
          <LockKeyhole size={20} />
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </span>
      </label>
      <div className="login-options">
        <label>
          <input type="checkbox" />
          {uiText(" Ghi nhớ đăng nhập")}
        </label>
        <Link href="/forgot-password">{uiText("Quên mật khẩu?")}</Link>
      </div>
      {state.error || oauthError || googleError ? (
        <p className="form-error" role="alert">
          {state.error ?? oauthError ?? googleError}
        </p>
      ) : null}
      <button
        className="button button-primary full-width"
        type="submit"
        disabled={pending}
      >
        {pending ? uiText("Đang đăng nhập…") : uiText("Đăng nhập")}
      </button>
      <div className="login-divider">
        <span>{uiText("hoặc")}</span>
      </div>
      <button
        className="button google-login full-width"
        type="button"
        onClick={signInWithGoogle}
        disabled={googlePending}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path
            fill="#4285F4"
            d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.4Z"
          />
          <path
            fill="#34A853"
            d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.2H3.1v2.6A10 10 0 0 0 12 22Z"
          />
          <path
            fill="#FBBC05"
            d="M6.4 13.9A6 6 0 0 1 6.1 12c0-.7.1-1.3.3-1.9V7.5H3.1A10 10 0 0 0 2 12c0 1.6.4 3.1 1.1 4.5l3.3-2.6Z"
          />
          <path
            fill="#EA4335"
            d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.9-2.9A9.7 9.7 0 0 0 12 2a10 10 0 0 0-8.9 5.5l3.3 2.6c.8-2.4 3-4.2 5.6-4.2Z"
          />
        </svg>
        {googlePending
          ? uiText("Đang chuyển sang Google…")
          : uiText("Đăng nhập bằng Google")}
      </button>
      <small className="google-domain-note">
        {uiText("Chỉ chấp nhận tài khoản Google có email @eiu.edu.vn.")}
      </small>
      <small>
        {uiText(
          "Chỉ nhân sự đã được tạo trước và cấp vai trò mới có thể đăng nhập.",
        )}
      </small>
    </form>
  );
}
