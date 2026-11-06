import { NextResponse } from "next/server";
import { safeInternalPath } from "@/lib/application-url.mjs";
import { createClient } from "@/lib/supabase/server";

function redirectOrigin(request: Request) {
  const requestUrl = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto") ?? "https";

  if (process.env.NODE_ENV !== "development" && forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }
  return requestUrl.origin;
}

function loginError(request: Request, message: string) {
  const url = new URL("/login", redirectOrigin(request));
  url.searchParams.set("error", message);
  return NextResponse.redirect(url);
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = safeInternalPath(
    requestUrl.searchParams.get("next"),
    "/dashboard",
  );
  const isPasswordRecovery = next === "/reset-password";

  if (!code) {
    return loginError(request, "Google không trả về mã đăng nhập hợp lệ.");
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) {
    return loginError(
      request,
      "Không thể hoàn tất đăng nhập Google. Vui lòng thử lại.",
    );
  }

  if (isPasswordRecovery) {
    return NextResponse.redirect(
      new URL("/reset-password", redirectOrigin(request)),
    );
  }

  const email = data.user.email?.trim().toLowerCase() ?? "";
  if (!email.endsWith("@eiu.edu.vn")) {
    await supabase.auth.signOut();
    return loginError(
      request,
      "Chỉ tài khoản Google có email @eiu.edu.vn được phép đăng nhập.",
    );
  }

  const [{ data: profile }, { count: roleCount }] = await Promise.all([
    supabase
      .from("profiles")
      .select("is_active,must_change_password")
      .eq("id", data.user.id)
      .maybeSingle(),
    supabase
      .from("user_roles")
      .select("role", { count: "exact", head: true })
      .eq("user_id", data.user.id),
  ]);

  if (!profile?.is_active || !roleCount) {
    await supabase.auth.signOut();
    return loginError(
      request,
      "Email này chưa được tạo hoặc chưa được cấp vai trò trong Nhân sự.",
    );
  }

  return NextResponse.redirect(
    new URL(
      profile.must_change_password ? "/change-password" : next,
      redirectOrigin(request),
    ),
  );
}
