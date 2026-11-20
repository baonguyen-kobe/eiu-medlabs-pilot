import { createClient } from "@/lib/supabase/server";

/** Rows of room_equipment_read / room_equipment_summary (t4r1). */
export type RoomSummaryRow = {
  room_id: string;
  room_code: string;
  building_code: string;
  room_name: string | null;
  room_type: string | null;
  fixed: number;
  temporary: number;
  damaged: number;
};

export type RoomFixedRow = {
  item_id: string;
  code: string;
  name: string;
  base_uom_code: string;
  return_semantics: string;
  good: string | null;
  damaged: string | null;
};

export type RoomAssetRow = {
  id: string;
  asset_code: string;
  name: string;
  operational_status: string;
  lifecycle_status: string;
};

export type RoomTemporaryRow = {
  request_id: string;
  return_at: string;
  code: string;
  name: string;
  base_uom_code: string;
  asset_id: string | null;
  asset_code: string | null;
  outstanding: string;
};

export type RoomEquipment = {
  room: {
    id: string;
    room_code: string;
    building_code: string;
    room_name: string | null;
    location_id: string | null;
  } | null;
  fixed: RoomFixedRow[];
  assets: RoomAssetRow[];
  temporary: RoomTemporaryRow[];
};

export async function readRoomSummary(
  query: string,
  page: number,
  hasEquipment = false,
) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("room_equipment_summary", {
    p_query: query || undefined,
    p_page: page,
    p_has_equipment: hasEquipment,
  });
  if (error) throw new Error(`Room equipment summary: ${error.message}`);
  return data as {
    total: number;
    page: number;
    page_size: number;
    rows: RoomSummaryRow[];
  };
}

export async function readRoomEquipment(roomId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("room_equipment_read", {
    p_room_id: roomId,
  });
  if (error) throw new Error(`Room equipment: ${error.message}`);
  return data as RoomEquipment;
}

export function roomLabel(room: { building_code: string; room_code: string }) {
  return [room.building_code, room.room_code].filter(Boolean).join("-");
}
