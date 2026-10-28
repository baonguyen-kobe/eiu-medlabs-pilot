import { z } from "zod";

export const operationPhases = {
  all: "Tất cả cần xử lý",
  prepare: "Cần chuẩn bị",
  handover: "Chờ giao",
  signature: "Chờ chữ ký",
  return: "Còn phải trả",
  hold: "Chờ đối soát hold",
} as const;
export const equipmentOperationsSchema = z.object({
  rows: z.array(
    z.object({
      id: z.guid(),
      status: z.string(),
      receive_at: z.string(),
      return_at: z.string(),
      return_overdue: z.boolean(),
      course_code: z.string(),
      course_name: z.string(),
      class_code: z.string().nullable(),
      responsible_name: z.string(),
      late_approval_status: z.string().nullable(),
      prepared: z.boolean(),
      has_preparation: z.boolean(),
      unsigned_count: z.number().int().nonnegative(),
      due_line_count: z.number().int().nonnegative(),
      hold_line_count: z.number().int().nonnegative(),
    }),
  ),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  page_size: z.literal(30),
});

export function equipmentOperationHref(row: {
  id: string;
  status: string;
  prepared: boolean;
  has_preparation: boolean;
}): string {
  if (!row.has_preparation && row.status !== "new")
    return `/equipment/requests?request=${row.id}`;
  return row.prepared ||
    (row.has_preparation && !["new", "preparing"].includes(row.status))
    ? `/equipment/fulfillment/${row.id}`
    : `/equipment/preparation/${row.id}`;
}
