import {
  applyBasicMedicalCatalogReconciliation,
  createBasicMedicalCatalogItem,
  importBasicMedicalEquipment,
  previewBasicMedicalCatalogReconciliation,
} from "@/app/basic-medical/equipment/actions";
import { BasicMedicalEquipmentManager } from "@/components/basic-medical-equipment-manager";
import { CatalogReconciliationImport } from "@/components/catalog-reconciliation-import";
import { CatalogImportNew } from "@/components/catalog-import-new";
import { Download } from "@/components/icons";
import { WorkspaceShell } from "@/components/workspace-shell";
import type {
  BasicMedicalConditionLogItem,
  BasicMedicalEquipmentCatalogItem,
  BasicMedicalRoomInventoryItem,
} from "@/lib/basic-medical-equipment";
import { BASIC_MEDICAL_ROOM_TYPE_ID } from "@/lib/room-types";
import { getViewer } from "@/lib/viewer";
import { canManageBasicMedicalWorkspace } from "@/lib/workspace-access";
import { canViewBasicMedicalSchedules } from "@/lib/workspace-access";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PaginationLinks } from "@/components/pagination-links";
import { normalizePage, paginationRange } from "@/lib/pagination";
import { LocalizedText } from "@/components/i18n/language-provider";
import { LocalizedElement } from "@/components/i18n/localized-element";

type Tab = "inventory" | "rooms" | "damaged" | "logs";

export default async function BasicMedicalEquipmentPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    q?: string;
    room?: string;
    status?: string;
    event?: string;
    item?: string;
    actor?: string;
    from?: string;
    to?: string;
    page?: string;
    notice?: string;
    error?: string;
  }>;
}) {
  const query = await searchParams;
  const {
    supabase,
    fullName,
    roles,
    roomTypes,
    allowBasicMedicalAccess,
    canImportSchedules,
    canManagePersonnel,
    canManageEmailNotifications,
    canManageBasicMedical,
  } = await getViewer();
  const roomTypeCodes = roomTypes.map(({ code }) => code);
  if (!canViewBasicMedicalSchedules(roles, roomTypeCodes))
    redirect("/dashboard");
  const canManage =
    canManageBasicMedical &&
    canManageBasicMedicalWorkspace(roles, roomTypeCodes);
  const activeTab: Tab = !canManage
    ? "rooms"
    : query.tab === "rooms" || query.tab === "damaged" || query.tab === "logs"
      ? query.tab
      : "inventory";
  const currentPage = normalizePage(query.page);
  const { from, to } = paginationRange(currentPage);
  const search = query.q?.trim() ?? "";

  const [searchResult, roomResult, candidateResult] = await Promise.all([
    supabase.rpc("search_basic_medical_equipment", {
      target_tab: activeTab,
      target_query: search || null,
      target_room_id: query.room || null,
      target_catalog_item_id: query.item || null,
      target_event_type: query.event || null,
      target_actor_id: query.actor || null,
      target_from_date: query.from || null,
      target_to_date: query.to || null,
      target_status: query.status || null,
      target_page: currentPage,
      target_page_size: to - from + 1,
    }),
    activeTab === "rooms" || activeTab === "damaged"
      ? supabase
          .from("rooms")
          .select("id,room_code,building_code,room_name")
          .eq("room_type_id", BASIC_MEDICAL_ROOM_TYPE_ID)
          .eq("is_active", true)
          .order("building_code")
          .order("room_code")
      : Promise.resolve({ data: [], error: null }),
    canManage && activeTab === "rooms"
      ? supabase.rpc("search_basic_medical_catalog_candidates", {
          target_query: null,
          target_limit: 30,
        })
      : Promise.resolve({ data: [], error: null }),
  ]);
  const loadError =
    searchResult.error ?? roomResult.error ?? candidateResult.error;
  const rows = (searchResult.data ?? []) as Array<{
    row_data: Record<string, unknown>;
    total_count: number;
  }>;
  const resultRows = rows.map(({ row_data }) => row_data);
  const totalItems = Number(rows[0]?.total_count ?? 0);

  return (
    <WorkspaceShell
      fullName={fullName}
      roles={roles}
      roomTypeCodes={roomTypeCodes}
      allowBasicMedicalAccess={allowBasicMedicalAccess}
      canImportSchedules={canImportSchedules}
      canManagePersonnel={canManagePersonnel}
      canManageEmailNotifications={canManageEmailNotifications}
      title={<LocalizedText text={"Danh sách thiết bị Y cơ sở"} />}
      description={
        <LocalizedText
          text={
            "Quản lý thiết bị riêng theo từng phòng, tình trạng Tốt/Hư và lịch sử thay đổi."
          }
        />
      }
    >
      {query.notice ? (
        <p className="action-feedback success">{query.notice}</p>
      ) : null}
      {query.error || loadError ? (
        <p className="action-feedback error" role="alert">
          {query.error ?? (
            <LocalizedText
              text="Không thể tải dữ liệu: {0}"
              values={[loadError?.message]}
            />
          )}
        </p>
      ) : null}
      <LocalizedElement
        as="nav"
        textAttributes={["aria-label"]}
        className="catalog-tabs basic-medical-equipment-tabs"
        aria-label="Thiết bị Y cơ sở"
      >
        {(canManage
          ? [
              ["inventory", "Thiết bị"],
              ["rooms", "Thiết bị theo phòng"],
              ["damaged", "Thiết bị hư"],
              ["logs", "Log thay đổi"],
            ]
          : [["rooms", "Thiết bị theo phòng"]]
        ).map(([tab, label]) => (
          <Link
            key={tab}
            className={activeTab === tab ? "active" : ""}
            href={`/basic-medical/equipment?tab=${tab}`}
            scroll={false}
          >
            <LocalizedText text={label} />
          </Link>
        ))}
      </LocalizedElement>
      <form className="basic-medical-list-filters" method="get">
        <input type="hidden" name="tab" value={activeTab} />
        <label className="data-search">
          <span className="sr-only">
            <LocalizedText text={"Tìm kiếm"} />
          </span>
          <LocalizedElement
            as="input"
            textAttributes={["placeholder"]}
            name="q"
            type="search"
            defaultValue={search}
            placeholder="Tìm thiết bị, phòng, người thay đổi, ghi chú…"
          />
        </label>
        {activeTab === "inventory" ? (
          <select name="status" defaultValue={query.status ?? ""}>
            <option value="">
              <LocalizedText text={"Tất cả trạng thái"} />
            </option>
            <option value="active">
              <LocalizedText text={"Đang sử dụng"} />
            </option>
            <option value="inactive">
              <LocalizedText text={"Ngừng sử dụng"} />
            </option>
          </select>
        ) : null}
        {activeTab === "rooms" || activeTab === "damaged" ? (
          <select name="room" defaultValue={query.room ?? ""}>
            <option value="">
              <LocalizedText text={"Tất cả phòng"} />
            </option>
            {(roomResult.data ?? []).map((room) => (
              <option key={room.id} value={room.id}>
                {room.room_code}.{room.building_code}
              </option>
            ))}
          </select>
        ) : null}
        {activeTab === "logs" ? (
          <>
            <select name="event" defaultValue={query.event ?? ""}>
              <option value="">
                <LocalizedText text={"Tất cả thay đổi"} />
              </option>
              <option value="damage_report">
                <LocalizedText text={"Báo Hư"} />
              </option>
              <option value="condition_adjustment">
                <LocalizedText text={"Điều chỉnh Tốt/Hư"} />
              </option>
              <option value="stock_adjustment">
                <LocalizedText text={"Điều chỉnh tồn kho"} />
              </option>
            </select>
            <LocalizedElement
              as="input"
              textAttributes={["placeholder"]}
              name="actor"
              defaultValue={query.actor}
              placeholder="ID người thực hiện"
            />
            <LocalizedElement
              as="input"
              textAttributes={["aria-label"]}
              name="from"
              type="date"
              defaultValue={query.from}
              aria-label="Từ ngày"
            />
            <LocalizedElement
              as="input"
              textAttributes={["aria-label"]}
              name="to"
              type="date"
              defaultValue={query.to}
              aria-label="Đến ngày"
            />
          </>
        ) : null}
        <button className="button button-primary" type="submit">
          <LocalizedText text={"Lọc"} />
        </button>
        <Link
          className="button button-secondary"
          href={`/basic-medical/equipment?tab=${activeTab}`}
        >
          <LocalizedText text={"Xóa bộ lọc"} />
        </Link>
      </form>
      {canManage && activeTab === "inventory" ? (
        <div className="basic-medical-catalog-actions">
          <form
            action={createBasicMedicalCatalogItem}
            className="data-panel catalog-inline-form equipment-catalog-create-form"
          >
            <div className="equipment-catalog-create-heading">
              <strong>
                <LocalizedText text={"Thêm thiết bị thủ công"} />
              </strong>
            </div>
            <div className="form-grid equipment-catalog-create-grid">
              {[
                ["item_name", "Tên thiết bị và vật tư *"],
                ["commercial_name", "Tên thương mại *"],
                ["item_type", "Loại"],
                ["country_of_origin", "Nước SX"],
                ["manufacturer", "Hãng"],
                ["model", "Model"],
                ["unit", "ĐVT *"],
              ].map(([name, label]) => (
                <label key={name}>
                  <span>
                    <LocalizedText text={label} />
                  </span>
                  <input
                    name={name}
                    required={
                      name === "item_name" ||
                      name === "commercial_name" ||
                      name === "unit"
                    }
                  />
                </label>
              ))}
            </div>
            <button type="submit" className="button button-primary">
              <LocalizedText text={"Thêm vào danh mục"} />
            </button>
          </form>

          <section className="data-panel equipment-catalog-import">
            <div className="equipment-import-actions">
              <a
                className="button equipment-template-download"
                href="/api/basic-medical-equipment-template"
              >
                <Download size={17} aria-hidden="true" />
                <LocalizedText text={" Tải template"} />
              </a>
              <CatalogImportNew action={importBasicMedicalEquipment} />
              <CatalogReconciliationImport
                preview={previewBasicMedicalCatalogReconciliation}
                apply={applyBasicMedicalCatalogReconciliation}
              />
              <a
                className="button equipment-export-all"
                href="/api/basic-medical-equipment-export"
              >
                <Download size={17} aria-hidden="true" />
                <LocalizedText text={" Export tất cả"} />
              </a>
            </div>
          </section>
        </div>
      ) : null}
      <BasicMedicalEquipmentManager
        activeTab={activeTab}
        catalog={
          (activeTab === "inventory"
            ? resultRows
            : (candidateResult.data ??
              [])) as unknown as BasicMedicalEquipmentCatalogItem[]
        }
        inventories={
          (activeTab === "rooms" || activeTab === "damaged"
            ? resultRows
            : []) as unknown as BasicMedicalRoomInventoryItem[]
        }
        rooms={
          (roomResult.data ?? []) as Array<{
            id: string;
            room_code: string;
            building_code: string;
            room_name: string | null;
          }>
        }
        logs={
          (activeTab === "logs"
            ? resultRows
            : []) as unknown as BasicMedicalConditionLogItem[]
        }
        canManage={canManage}
      />
      <PaginationLinks
        currentPage={currentPage}
        totalItems={totalItems}
        pathname="/basic-medical/equipment"
        query={{
          tab: activeTab,
          q: search || undefined,
          room: query.room,
          status: query.status,
          event: query.event,
          actor: query.actor,
          from: query.from,
          to: query.to,
        }}
      />
    </WorkspaceShell>
  );
}
