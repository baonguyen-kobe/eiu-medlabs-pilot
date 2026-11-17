export type CalendarEquipmentRequest<TStatus extends string = string> = {
  id: string;
  status: TStatus;
};

export function normalizeCalendarEquipmentRequest<
  TStatus extends string = string,
>(value: unknown) {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object") return undefined;
  const { id, status } = row as { id?: unknown; status?: unknown };
  if (typeof id !== "string" || typeof status !== "string") {
    return undefined;
  }
  return { id, status } as CalendarEquipmentRequest<TStatus>;
}

export function equipmentRequestDeepLink(
  roles: readonly string[],
  requestId: string,
) {
  const path = roles.some((role) => role === "admin" || role === "staff")
    ? "/equipment/requests"
    : "/equipment/mine";
  return `${path}?request=${encodeURIComponent(requestId)}`;
}

export function isEquipmentRequestId(value: string | undefined) {
  return Boolean(
    value?.match(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    ),
  );
}
