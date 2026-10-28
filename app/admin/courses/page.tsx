import { AdminShell } from "@/components/admin-shell";
import { createCourse, importCourses } from "@/app/admin/actions";
import { CatalogTabs } from "@/components/catalog-tabs";
import { CatalogImportActions } from "@/components/catalog-import-actions";
import { PaginationLinks } from "@/components/pagination-links";
import { requireAdmin } from "@/lib/admin";
import { normalizePage, paginationRange } from "@/lib/pagination";
import { CatalogBatchManager } from "@/components/catalog-batch-manager";
import { LocalizedText } from "@/components/i18n/language-provider";
import { LocalizedElement } from "@/components/i18n/localized-element";

export default async function CoursesPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string; page?: string }>;
}) {
  const { supabase } = await requireAdmin();
  const query = await searchParams;
  const currentPage = normalizePage(query.page);
  const { from, to } = paginationRange(currentPage);
  const [{ data: courses, count }, { data: roomTypes }] = await Promise.all([
    supabase
      .from("courses")
      .select(
        "id, course_code, course_name, room_type_id, is_active, room_types (name)",
        { count: "exact" },
      )
      .order("course_code")
      .range(from, to),
    supabase.from("room_types").select("id, name, is_active").order("name"),
  ]);

  return (
    <AdminShell
      title={<LocalizedText text={"Danh mục môn học"} />}
      description={
        <LocalizedText
          text={"Tạo mới, ngừng sử dụng hoặc xóa môn học chưa phát sinh lịch."}
        />
      }
      active="/admin/courses"
      actions={
        <CatalogImportActions action={importCourses} catalog="courses" />
      }
    >
      <CatalogTabs active="/admin/courses" />
      {query.notice ? (
        <p className="action-feedback success">
          <LocalizedText text={query.notice} />
        </p>
      ) : null}
      {query.error ? (
        <p className="action-feedback error">
          <LocalizedText text={query.error} />
        </p>
      ) : null}
      <details className="catalog-manual-add">
        <summary>
          <LocalizedText text={"+ Thêm môn học"} />
        </summary>
        <form
          action={createCourse}
          className="admin-create-form admin-create-course"
        >
          <label>
            <LocalizedText text={"Mã môn học"} />
            <input name="course_code" required placeholder="NUR 301" />
          </label>
          <label>
            <LocalizedText text={"Tên môn học"} />
            <LocalizedElement
              as="input"
              textAttributes={["placeholder"]}
              name="course_name"
              required
              placeholder="Tên môn học"
            />
          </label>
          <label>
            <LocalizedText text={"Loại"} />
            <select name="room_type_id" required defaultValue="">
              <option value="" disabled>
                <LocalizedText text={"Chọn Loại"} />
              </option>
              {(roomTypes ?? [])
                .filter(({ is_active }) => is_active)
                .map((roomType) => (
                  <option key={roomType.id} value={roomType.id}>
                    {roomType.name}
                  </option>
                ))}
            </select>
          </label>
          <button className="button button-primary">
            <LocalizedText text={"Thêm môn học"} />
          </button>
        </form>
      </details>
      <CatalogBatchManager
        kind="courses"
        initialItems={(courses ?? []).map((course) => ({
          ...course,
          room_types: course.room_types as unknown as { name: string } | null,
        }))}
        roomTypes={roomTypes ?? []}
      />
      <PaginationLinks
        currentPage={currentPage}
        totalItems={count ?? 0}
        pathname="/admin/courses"
      />
    </AdminShell>
  );
}
