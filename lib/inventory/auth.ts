import { redirect } from "next/navigation";
import { getViewer, type AppRole } from "@/lib/viewer";

export interface InventoryViewerContext {
  userId: string;
  email: string;
  fullName: string;
  roles: AppRole[];
  isAdmin: boolean;
  isStaff: boolean;
  allowCostView: boolean;
}

export function canAccessInventory(roles: AppRole[]): boolean {
  return roles.includes("admin") || roles.includes("staff");
}

export function canManageInventoryAdmin(roles: AppRole[]): boolean {
  return roles.includes("admin");
}

/**
 * Requires active authenticated user with Admin or Staff role.
 * Redirects or throws if access is denied.
 */
export async function requireInventoryViewer(): Promise<InventoryViewerContext> {
  const viewer = await getViewer();
  const isAdmin = viewer.roles.includes("admin");
  const isStaff = viewer.roles.includes("staff");

  if (!isAdmin && !isStaff) {
    redirect("/dashboard");
  }

  return {
    userId: viewer.userId,
    email: viewer.email,
    fullName: viewer.fullName,
    roles: viewer.roles,
    isAdmin,
    isStaff,
    allowCostView: true, // INV-018: both Admin and Staff have cost visibility
  };
}

/**
 * Requires active Admin role for sensitive inventory operations
 * (opening balance, unknown expiry verification, master inactivate/reactivate, source void, UOM configuration).
 */
export async function requireInventoryAdmin(): Promise<InventoryViewerContext> {
  const viewer = await requireInventoryViewer();
  if (!viewer.isAdmin) {
    throw new Error(
      "PERMISSION_DENIED: Thao tác này chỉ dành riêng cho Quản trị viên (Admin) / Administrator role required",
    );
  }
  return viewer;
}
