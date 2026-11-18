import Link from "next/link";
import { getInterfaceText } from "@/lib/i18n/server";

export type IntakeKind = "quantity" | "asset";

export function intakeKind(value: string | undefined): IntakeKind {
  return value === "asset" ? "asset" : "quantity";
}

/** One intake page per task (t2f): stock by quantity or coded assets. */
export async function IntakeKindSwitch({
  path,
  kind,
}: {
  path: string;
  kind: IntakeKind;
}) {
  const text = await getInterfaceText();
  return (
    <nav className="segmented-control" aria-label={text("Loại hàng")}>
      {(
        [
          ["quantity", "Theo số lượng", path],
          ["asset", "Thiết bị có mã", `${path}?kind=asset`],
        ] as const
      ).map(([value, label, href]) => (
        <Link
          key={value}
          href={href}
          scroll={false}
          className={kind === value ? "selected" : ""}
          aria-current={kind === value ? "page" : undefined}
        >
          {text(label)}
        </Link>
      ))}
    </nav>
  );
}
