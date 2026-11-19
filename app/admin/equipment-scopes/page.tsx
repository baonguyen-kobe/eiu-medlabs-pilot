import Link from "next/link";
import { AdminShell } from "@/components/admin-shell";
import { CatalogTabs } from "@/components/catalog-tabs";
import { LocalizedText } from "@/components/i18n/language-provider";
import { PaginationLinks } from "@/components/pagination-links";
import { requireAdmin } from "@/lib/admin";
import { getInterfaceText } from "@/lib/i18n/server";
import { normalizePage, paginationRange } from "@/lib/pagination";
import { setEquipmentItemScopes } from "./actions";

type Item = {
  id: string;
  item_name: string;
  commercial_name: string;
  unit: string;
  is_active: boolean;
  usage_scopes: string[];
};
type Duplicate = {
  commercial_name: string;
  skills_item_name: string;
  basic_medical_item_name: string;
};

const scopes = [
  ["nursing_skills", "Skills lab"],
  ["basic_medical", "Y cơ sở"],
] as const;

/** One equipment catalog (t4e step 2): tick which sides use each item. */
export default async function EquipmentScopesPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    page?: string;
    notice?: string;
    error?: string;
  }>;
}) {
  const { supabase } = await requireAdmin();
  const query = await searchParams;
  const text = await getInterfaceText();
  const q = query.q?.trim().slice(0, 100) ?? "";
  const currentPage = normalizePage(query.page);
  const { from, to } = paginationRange(currentPage);
  let list = supabase
    .from("equipment_items")
    .select("id,item_name,commercial_name,unit,is_active,usage_scopes", {
      count: "exact",
    })
    .order("item_name")
    .order("commercial_name")
    .range(from, to);
  if (q) {
    // PostgREST or() syntax: strip its separators from the search term.
    const pattern = `%${q.replace(/[%_,()*]/g, " ")}%`;
    list = list.or(
      `item_name.ilike.${pattern},commercial_name.ilike.${pattern}`,
    );
  }
  const [{ data: rows, count, error }, { data: duplicates }] =
    await Promise.all([
      list,
      supabase.rpc("equipment_catalog_scope_duplicates"),
    ]);
  if (error) throw new Error(`Equipment scopes: ${error.message}`);
  const items = (rows ?? []) as Item[];
  const clashes = (duplicates ?? []) as Duplicate[];
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (currentPage > 1) params.set("page", String(currentPage));
  const back = params.size
    ? `/admin/equipment-scopes?${params}`
    : "/admin/equipment-scopes";

  return (
    <AdminShell
      title={<LocalizedText text={"Phạm vi thiết bị"} />}
      description={
        <LocalizedText
          text={
            "Một danh mục thiết bị: tick bên nào được dùng từng thiết bị (Skills lab, Y cơ sở hoặc cả hai)."
          }
        />
      }
      active="/admin/equipment-scopes"
    >
      <CatalogTabs active="/admin/equipment-scopes" />
      {query.notice ? (
        <p className="action-feedback success" role="status">
          {text(query.notice)}
        </p>
      ) : null}
      {query.error ? (
        <p className="action-feedback error" role="alert">
          {text(query.error)}
        </p>
      ) : null}

      {clashes.length ? (
        <section
          className="data-panel"
          aria-label={text("Trùng tên giữa hai bên")}
        >
          <h2>{text("Trùng tên giữa hai bên ({0})", [clashes.length])}</h2>
          <p>
            {text(
              "Cùng tên thương mại nhưng là hai dòng. Kiểm tra rồi giữ một dòng và tick cả hai bên; dòng thừa ngừng dùng ở trang danh mục của bên đó.",
            )}
          </p>
          <ul>
            {clashes.map((clash) => (
              <li key={clash.commercial_name}>
                <strong>{clash.commercial_name}</strong> —{" "}
                {text("Skills lab: {0} · Y cơ sở: {1}", [
                  clash.skills_item_name,
                  clash.basic_medical_item_name,
                ])}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <form className="list-filters equipment-scopes-filters" method="get">
        <label>
          {text("Tìm kiếm")}
          <input
            name="q"
            defaultValue={q}
            placeholder={text("Tên thiết bị hoặc tên thương mại")}
          />
        </label>
        <div className="list-filters-actions">
          <button type="submit" className="button button-primary">
            {text("Lọc")}
          </button>
          {q ? (
            <Link
              href="/admin/equipment-scopes"
              className="button button-secondary"
            >
              {text("Xóa bộ lọc")}
            </Link>
          ) : null}
          <span className="inline-toolbar-count">
            {text("{0} thiết bị", [count ?? 0])}
          </span>
        </div>
      </form>

      {items.length === 0 ? (
        <p className="panel-empty">{text("Không có thiết bị nào.")}</p>
      ) : (
        <div className="data-panel">
          <div className="responsive-table">
            <table className="data-table records-on-phone">
              <thead>
                <tr>
                  <th>{text("Thiết bị")}</th>
                  <th>{text("Dùng cho")}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td data-label={text("Thiết bị")}>
                      <span className="cell-stack">
                        <strong>{item.item_name}</strong>
                        <small>
                          {item.commercial_name} · {item.unit}
                          {item.is_active ? "" : ` · ${text("Ngừng dùng")}`}
                        </small>
                      </span>
                    </td>
                    <td data-label={text("Dùng cho")}>
                      <form
                        action={setEquipmentItemScopes}
                        className="list-filters-actions"
                      >
                        <input type="hidden" name="id" value={item.id} />
                        <input type="hidden" name="back" value={back} />
                        {scopes.map(([value, label]) => (
                          <label key={value} className="scope-check">
                            <input
                              type="checkbox"
                              name="scope"
                              value={value}
                              defaultChecked={item.usage_scopes.includes(value)}
                            />
                            {text(label)}
                          </label>
                        ))}
                        <button
                          type="submit"
                          className="button button-secondary"
                        >
                          {text("Lưu")}
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <PaginationLinks
        currentPage={currentPage}
        totalItems={count ?? 0}
        pathname="/admin/equipment-scopes"
        query={{ q }}
      />
    </AdminShell>
  );
}
