import type { ReactNode } from "react";

/**
 * Shared workspace page heading. Every authenticated route receives the same
 * compact title, contextual description, and action rhythm through this
 * pattern rather than recreating a page-specific header shell.
 */
export function PageHeader({
  menu,
  title,
  description,
  actions,
}: {
  menu?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="workspace-topbar page-header">
      {menu}
      <div className="page-header-copy">
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="workspace-actions">{actions}</div> : null}
    </header>
  );
}
