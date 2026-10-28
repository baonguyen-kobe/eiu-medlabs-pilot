import { NextResponse } from "next/server";
import {
  createEquipmentHandoverPdf,
  type EquipmentHandoverRequest,
} from "@/lib/equipment-handover-pdf";
import { formatEquipmentRequestCode } from "@/lib/equipment-request-code";
import { equipmentHandoverSelect } from "@/lib/equipment-requests";
import { createClient } from "@/lib/supabase/server";
import { canManageEquipmentRequestDomain } from "@/lib/workspace-access";
import type { AppRole } from "@/lib/viewer";
import { fulfillmentSchema } from "@/lib/equipment-fulfillment";
import { createEquipmentFulfillmentPdf } from "@/lib/equipment-fulfillment-pdf";
import { isEquipmentRequestId } from "@/lib/equipment-calendar-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ requestId: string }> },
) {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) {
    return NextResponse.json({ error: "Chưa đăng nhập." }, { status: 401 });
  }

  const { requestId } = await params;
  if (!isEquipmentRequestId(requestId))
    return NextResponse.json(
      { error: "Mã phiếu không hợp lệ." },
      { status: 400 },
    );
  const [{ data, error }, { data: roleRows }, { data: roomTypeRows }] =
    await Promise.all([
      supabase
        .from("equipment_requests")
        .select(equipmentHandoverSelect)
        .eq("id", requestId)
        .maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", userId),
      supabase
        .from("profile_room_types")
        .select("room_types(code)")
        .eq("profile_id", userId),
    ]);
  if (error) {
    console.error("Không thể tải phiếu giao nhận thiết bị", {
      requestId,
      error,
    });
    return NextResponse.json(
      { error: "Không thể tải phiếu giao nhận thiết bị." },
      { status: 500 },
    );
  }
  if (!data) {
    return NextResponse.json(
      { error: "Không tìm thấy phiếu thiết bị." },
      { status: 404 },
    );
  }

  const roles = (roleRows ?? []).map(({ role }) => role) as AppRole[];
  const roomTypeCodes = (roomTypeRows ?? []).flatMap((row) => {
    const roomType = row.room_types as { code?: string } | null;
    return roomType?.code ? [roomType.code] : [];
  });
  const request = data as unknown as EquipmentHandoverRequest;
  if (
    !canManageEquipmentRequestDomain(
      roles,
      roomTypeCodes,
      request.request_domain,
    )
  ) {
    return NextResponse.json(
      { error: "Bạn không có quyền xuất phiếu giao nhận này." },
      { status: 403 },
    );
  }

  try {
    const { data: preparations, error: preparationError } = await supabase
      .from("equipment_preparations")
      .select("id")
      .eq("request_id", requestId)
      .limit(1);
    if (preparationError)
      throw new Error("Không kiểm tra được nguồn dữ liệu giao nhận.");
    let output: Buffer;
    if (preparations?.length && request.request_domain === "nursing_skills") {
      const first = await supabase.rpc("equipment_fulfillment_read", {
        p_request_id: requestId,
        p_page: 1,
      });
      if (first.error) throw new Error("Không đọc được sự kiện giao nhận.");
      const workspace = fulfillmentSchema.parse(first.data);
      if (workspace.event_count > 1000)
        return NextResponse.json(
          {
            error:
              "Phiếu có trên 1.000 sự kiện; cần xuất lịch sử qua quy trình hỗ trợ, không xuất thiếu dữ liệu.",
          },
          { status: 422 },
        );
      for (
        let page = 2;
        page <= Math.ceil(workspace.event_count / 50);
        page++
      ) {
        const next = await supabase.rpc("equipment_fulfillment_read", {
          p_request_id: requestId,
          p_page: page,
        });
        if (next.error) throw new Error("Không đọc đủ lịch sử giao nhận.");
        const parsed = fulfillmentSchema.parse(next.data);
        if (parsed.revision !== workspace.revision)
          return NextResponse.json(
            {
              error:
                "Phiếu vừa thay đổi trong lúc xuất. Hãy tải lại và xuất lại.",
            },
            { status: 409 },
          );
        workspace.events.push(...parsed.events);
      }
      const signatures: {
        event_id: string;
        actor_id: string;
        snapshot_hash: string;
        signed_at: string;
        signature: string;
      }[] = [];
      for (let offset = 0; offset < workspace.events.length; offset += 50) {
        const part = await supabase
          .from("equipment_fulfillment_signatures")
          .select("event_id,actor_id,snapshot_hash,signed_at,signature")
          .in(
            "event_id",
            workspace.events
              .slice(offset, offset + 50)
              .map((event) => event.id),
          );
        if (part.error) throw new Error("Không đọc được chữ ký sự kiện.");
        signatures.push(...part.data);
      }
      if (
        workspace.events.some(
          (event) =>
            event.signature &&
            !signatures.some((signature) => signature.event_id === event.id),
        )
      )
        throw new Error("Thiếu bằng chứng chữ ký.");
      const latest = await supabase
        .from("equipment_requests")
        .select("fulfillment_revision")
        .eq("id", requestId)
        .single();
      if (
        latest.error ||
        latest.data.fulfillment_revision !== workspace.revision
      )
        return NextResponse.json(
          {
            error:
              "Phiếu vừa thay đổi. Hãy xuất lại để có bằng chứng nhất quán.",
          },
          { status: 409 },
        );
      output = await createEquipmentFulfillmentPdf(workspace, signatures);
    } else output = await createEquipmentHandoverPdf(request);
    const code = formatEquipmentRequestCode(request.created_at);
    return new NextResponse(new Uint8Array(output), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="phieu-giao-nhan-${code}.pdf"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Không thể tạo phiếu giao nhận thiết bị", error);
    return NextResponse.json(
      { error: "Không thể tạo phiếu giao nhận thiết bị." },
      { status: 500 },
    );
  }
}
