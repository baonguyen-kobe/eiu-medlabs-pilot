import Link from "next/link";
import { getInterfaceText } from "@/lib/i18n/server";

export type RegisterScope = "skills" | "basic_medical";

/** One Đăng ký thiết bị screen for both sides (t4e step 1). */
export async function RegisterScopeSwitch({ scope }: { scope: RegisterScope }) {
  const text = await getInterfaceText();
  return (
    <nav className="segmented-control" aria-label={text("Phạm vi đăng ký")}>
      {(
        [
          ["skills", "Skills lab", "/equipment/register"],
          [
            "basic_medical",
            "Y cơ sở",
            "/equipment/register?scope=basic_medical",
          ],
        ] as const
      ).map(([value, label, href]) => (
        <Link
          key={value}
          href={href}
          className={scope === value ? "selected" : ""}
          aria-current={scope === value ? "page" : undefined}
        >
          {text(label)}
        </Link>
      ))}
    </nav>
  );
}
