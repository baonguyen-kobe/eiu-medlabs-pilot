import { getInterfaceText } from "@/lib/i18n/server";
import { LocalizedImage as Image } from "@/components/i18n/localized-image";
import { LoginForm } from "./login-form";

export async function generateMetadata() {
  const text = await getInterfaceText();
  return { title: text("Đăng nhập") };
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const query = await searchParams;

  return (
    <main className="login-page">
      <section
        className="login-brand"
        aria-label="Eastern International University"
      >
        <Image
          className="login-brand-image"
          src="/login-cover-campus-2.jpg"
          alt="Khuôn viên Trường Đại học Quốc tế Miền Đông"
          fill
          priority
          sizes="100vh"
        />
      </section>
      <Image
        className="login-corner-logo"
        src="/eiu-corner-logo.png"
        alt="Eastern International University"
        width={190}
        height={190}
        sizes="(max-width: 900px) 160px, 1px"
      />
      <section className="login-form-wrap">
        <LoginForm oauthError={query.error} />
      </section>
    </main>
  );
}
