import type { SupabaseClient } from "@supabase/supabase-js";
import { formatEquipmentRequestCode } from "@/lib/equipment-request-code";
import type { FulfillmentSummary } from "@/lib/equipment-fulfillment";

const timeFormat = new Intl.DateTimeFormat("vi-VN", {
  hour: "2-digit",
  minute: "2-digit",
  day: "2-digit",
  month: "2-digit",
  timeZone: "Asia/Ho_Chi_Minh",
});

type RequestRow = {
  created_at: string;
  receive_at: string;
  return_at: string;
  registrant: { full_name: string } | null;
  responsible: { full_name: string } | null;
  class_schedules: {
    schedule_date: string;
    start_time: string;
    end_time: string;
    course_code_snapshot: string;
    course_name_snapshot: string;
    rooms: { room_code: string; building_code: string } | null;
  } | null;
};

/** Facts for a Kho record header: code, class, room, time and people. */
export async function loadRequestSummary(
  supabase: SupabaseClient,
  requestId: string,
): Promise<FulfillmentSummary> {
  const { data } = await supabase
    .from("equipment_requests")
    .select(
      "created_at,receive_at,return_at,registrant:profiles!equipment_requests_registrant_id_fkey(full_name),responsible:profiles!equipment_requests_responsible_lecturer_id_fkey(full_name),class_schedules(schedule_date,start_time,end_time,course_code_snapshot,course_name_snapshot,rooms(room_code,building_code))",
    )
    .eq("id", requestId)
    .maybeSingle();
  const request = data as unknown as RequestRow | null;
  const schedule = request?.class_schedules;
  return {
    code: request ? formatEquipmentRequestCode(request.created_at) : "",
    course: schedule
      ? `${schedule.course_code_snapshot} · ${schedule.course_name_snapshot}`
      : "",
    room: schedule?.rooms
      ? `${schedule.rooms.building_code}-${schedule.rooms.room_code}`
      : "",
    session: schedule
      ? `${schedule.schedule_date.split("-").reverse().join("/")} · ${schedule.start_time.slice(0, 5)}–${schedule.end_time.slice(0, 5)}`
      : "",
    handover: request
      ? `${timeFormat.format(new Date(request.receive_at))} → ${timeFormat.format(new Date(request.return_at))}`
      : "",
    registrant: request?.registrant?.full_name ?? "",
    responsible: request?.responsible?.full_name ?? "",
  };
}

/** Active people by id, to name history actors; unknown ids stay unnamed. */
export async function loadPeopleNames(
  supabase: SupabaseClient,
): Promise<Record<string, string>> {
  const { data } = await supabase.rpc("list_active_people");
  return Object.fromEntries(
    ((data ?? []) as Array<{ id: string; full_name: string }>).map((person) => [
      person.id,
      person.full_name,
    ]),
  );
}
