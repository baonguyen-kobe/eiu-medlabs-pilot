import { z } from "zod";
import { preparationWorkspaceSchema } from "@/lib/equipment-preparation";

export const preparationSettingsSchema = z.object({
  revision: z.number().int().positive(),
  warning_lead_minutes: z.number().int().min(1).max(10080),
  inactivity_minutes: z.number().int().min(1).max(120),
});
export const preparationSettingsCommandSchema =
  preparationSettingsSchema.extend({
    reason: z.string().trim().min(1).max(1000),
  });
export const preparationQueueFiltersSchema = z.object({
  page: z.number().int().min(1).max(100000),
  search: z.string().max(120),
  status: z.enum(["new", "preparing", "all"]),
  sort: z.enum(["priority", "pickup", "class"]),
});
export const preparationQueueSchema = z.object({
  rows: z
    .array(
      z.object({
        id: z.guid(),
        status: z.enum(["new", "preparing"]),
        receive_at: z.string(),
        class_at: z.string(),
        course_code: z.string(),
        course_name: z.string(),
        class_code: z.string().nullable(),
        preparation_state: z
          .enum(["draft", "prepared", "reversing"])
          .nullable(),
        primary_preparer: z.guid().nullable(),
        primary_preparer_name: z.string().nullable(),
        overdue: z.boolean(),
        health:
          preparationWorkspaceSchema.shape.preparation.unwrap().shape.health,
      }),
    )
    .max(30),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  page_size: z.literal(30),
  admin: z.boolean(),
  settings: preparationSettingsSchema,
});
export type PreparationSettings = z.infer<typeof preparationSettingsSchema>;
export type PreparationSettingsCommand = z.infer<
  typeof preparationSettingsCommandSchema
>;
export type PreparationQueueFilters = z.infer<
  typeof preparationQueueFiltersSchema
>;
export type PreparationQueue = z.infer<typeof preparationQueueSchema>;
