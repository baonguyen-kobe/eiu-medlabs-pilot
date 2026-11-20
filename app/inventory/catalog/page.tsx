import { CatalogTabs } from "@/components/catalog-tabs";
import { getViewer } from "@/lib/viewer";
import { canManageBasicMedicalWorkspace } from "@/lib/workspace-access";
import React from "react";
import { requireInventoryViewer } from "@/lib/inventory/auth";
import { inventoryRead, isUuid } from "@/lib/inventory/client";
import { CatalogView } from "@/components/inventory/catalog-view";
import type { InventoryCatalogItem } from "@/lib/inventory/types";

interface CatalogPageProps {
  searchParams: Promise<{
    q?: string;
    category_id?: string;
    active?: string;
    sort?: string;
    page?: string;
    page_size?: string;
  }>;
}

export default async function CatalogPage({ searchParams }: CatalogPageProps) {
  const viewer = await requireInventoryViewer();
  const { roomTypes } = await getViewer();
  const roomTypeCodes = roomTypes.map(({ code }) => code);
  const params = await searchParams;

  const q = (params.q ?? "").trim();
  const categoryId = isUuid(params.category_id?.trim())
    ? params.category_id?.trim()
    : undefined;
  const rawActive = params.active ?? "all";
  const active =
    rawActive === "active" || rawActive === "true"
      ? true
      : rawActive === "inactive" || rawActive === "false"
        ? false
        : undefined;

  const sort = params.sort?.trim() || undefined;
  const page = Math.max(1, Number(params.page) || 1);
  const pageSize = Math.min(Math.max(1, Number(params.page_size) || 50), 100);

  const itemsRes = await inventoryRead<InventoryCatalogItem>("items", {
    q: q || undefined,
    category_id: categoryId,
    active,
    sort,
    page,
    page_size: pageSize,
  });

  return (
    <div className="space-y-6">
      <CatalogTabs
        active="/inventory/catalog"
        canAdmin={viewer.isAdmin}
        canBasicMedical={
          viewer.isAdmin ||
          canManageBasicMedicalWorkspace(viewer.roles, roomTypeCodes)
        }
      />
      <CatalogView
        initialItems={itemsRes.rows}
        total={itemsRes.total}
        currentPage={page}
        pageSize={pageSize}
        currentQ={q}
        currentCategoryId={categoryId || ""}
        currentActive={rawActive}
        currentSort={sort || ""}
        isAdmin={viewer.isAdmin}
      />
    </div>
  );
}
