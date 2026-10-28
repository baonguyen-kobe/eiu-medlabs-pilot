import type { ReactNode } from "react";

/** The outer WorkspaceShell owns the page h1 and sticky topbar. */
export function InventoryPageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <h2 className="text-xl font-bold text-[var(--eiu-blue)] break-words">
          {title}
        </h2>
        {description ? (
          <p className="mt-1 text-sm text-[var(--muted)]">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex min-w-0 flex-wrap gap-2">{actions}</div>
      ) : null}
    </div>
  );
}
