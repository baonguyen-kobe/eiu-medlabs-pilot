import { redirect } from "next/navigation";
import {
  EquipmentCatalogManager,
  type EquipmentCatalogItem,
} from "@/components/equipment-catalog-manager";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getViewer } from "@/lib/viewer";
import { createEquipmentCatalogItem } from "./actions";
import { LocalizedText } from "@/components/i18n/language-provider";

export default async function EquipmentCatalogPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const {
    supabase,
    fullName,
    roles,
    roomTypes,
    allowBasicMedicalAccess,
    canImportSchedules,
    canManagePersonnel,
    canManageEmailNotifications,
  } = await getViewer();
  if (!roles.some((role) => ["admin", "staff"].includes(role))) {
    redirect("/dashboard");
  }
  const catalogPromise = (async () => {
    const rows: EquipmentCatalogItem[] = [];
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await supabase
        .from("equipment_catalog")
        .select(
          "id,item_name,commercial_name,item_type,country_of_origin,manufacturer,model,unit,is_active",
        )
        .order("item_name")
        .range(from, from + pageSize - 1);
      if (error) break;
      rows.push(...((data ?? []) as EquipmentCatalogItem[]));
      if (!data || data.length < pageSize) break;
    }
    return rows;
  })();
  const [data, query] = await Promise.all([catalogPromise, searchParams]);

  return (
    <WorkspaceShell
      fullName={fullName}
      roles={roles}
      roomTypeCodes={roomTypes.map(({ code }) => code)}
      allowBasicMedicalAccess={allowBasicMedicalAccess}
      canImportSchedules={canImportSchedules}
      canManagePersonnel={canManagePersonnel}
      canManageEmailNotifications={canManageEmailNotifications}
      title={<LocalizedText text={"Danh mục thiết bị"} />}
      description={
        <LocalizedText
          text={"Thiết bị và vật tư dùng cho phiếu đăng ký Skills lab."}
        />
      }
    >
      {query.notice || query.error ? (
        <p className={query.error ? "form-error" : "form-success"}>
          {query.error ?? query.notice}
        </p>
      ) : null}

      <details className="catalog-manual-add">
        <summary>
          <LocalizedText text={"+ Thêm thiết bị"} />
        </summary>
        <form
          action={createEquipmentCatalogItem}
          className="data-panel catalog-inline-form equipment-catalog-create-form"
        >
          <div className="equipment-catalog-create-heading">
            <strong>
              <LocalizedText text={"Thêm thiết bị thủ công"} />
            </strong>
          </div>
          <div className="form-grid equipment-catalog-create-grid">
            <label>
              <LocalizedText text={"Tên thiết bị và vật tư *"} />
              <input name="item_name" required />
            </label>
            <label>
              <LocalizedText text={"Tên thương mại *"} />
              <input name="commercial_name" required />
            </label>
            <label>
              <LocalizedText text={"Loại"} />
              <input name="item_type" />
            </label>
            <label>
              <LocalizedText text={"Nước SX"} />
              <input name="country_of_origin" />
            </label>
            <label>
              <LocalizedText text={"Hãng"} />
              <input name="manufacturer" />
            </label>
            <label>
              <LocalizedText text={"Model"} />
              <input name="model" />
            </label>
            <label>
              <LocalizedText text={"ĐVT *"} />
              <input name="unit" required />
            </label>
          </div>
          <button className="button button-primary">
            <LocalizedText text={"Thêm vào danh mục"} />
          </button>
        </form>
      </details>

      <EquipmentCatalogManager initialItems={data} />
    </WorkspaceShell>
  );
}
