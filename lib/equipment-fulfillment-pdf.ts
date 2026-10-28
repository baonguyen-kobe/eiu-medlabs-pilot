import path from "node:path";
import PDFDocument from "pdfkit";
import type { Fulfillment } from "./equipment-fulfillment";

type Signature = {
  event_id: string;
  actor_id: string;
  snapshot_hash: string;
  signed_at: string;
  signature: string;
};
const effectLabels: Record<string, string> = {
  issue: "Thực giao",
  receipt: "Thực nhận",
  issue_correction: "Bù trừ giao",
  resolution: "Xử lý không thu hồi",
  consequence: "Xử lý tài sản",
  hold: "Tạm giữ đối soát",
  reconciliation: "Đối soát tạm giữ",
};
const eventLabels: Record<string, string> = {
  handover: "Giao lần đầu",
  supplement: "Giao bổ sung",
  initial_return: "Trả lần đầu",
  recover: "Thu hồi / trả muộn",
  resolve: "Xử lý không thu hồi",
  consequence: "Xử lý tài sản",
  reconcile: "Đối soát",
  correct: "Đính chính",
};

/** Export physical facts; never substitute original/planned request quantities. */
export async function createEquipmentFulfillmentPdf(
  workspace: Fulfillment,
  signatures: Signature[],
): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4",
    margin: 40,
    info: {
      Title: "Bằng chứng giao nhận MedLabs",
      Subject: `Request ${workspace.request_id}; revision ${workspace.revision}`,
    },
  });
  const chunks: Buffer[] = [];
  const output = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  const fonts = path.join(
    process.cwd(),
    "node_modules",
    "@expo-google-fonts",
    "be-vietnam-pro",
  );
  doc.registerFont(
    "Regular",
    path.join(fonts, "400Regular", "BeVietnamPro_400Regular.ttf"),
  );
  doc.registerFont(
    "Bold",
    path.join(fonts, "700Bold", "BeVietnamPro_700Bold.ttf"),
  );
  const dateTime = new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Ho_Chi_Minh",
  });
  function text(value: string, bold = false) {
    doc
      .font(bold ? "Bold" : "Regular")
      .fontSize(bold ? 11 : 9)
      .fillColor(bold ? "#153f6d" : "#111827");
    const height = doc.heightOfString(value, { width: 515 });
    if (doc.y + height > doc.page.height - 50) doc.addPage();
    doc.text(value, { width: 515 }).moveDown(0.4);
  }
  try {
    text("EIU MEDLABS — BẰNG CHỨNG GIAO NHẬN", true);
    text(
      `Phiếu: ${workspace.request_id} · Phiên bản xuất: ${workspace.revision}`,
    );
    text(
      "Bản xuất sự kiện vật lý và chữ ký. Tên dụng cụ là nhãn danh mục tra cứu hiện tại; số lượng, mã nguồn và snapshot không bị thay bằng số đăng ký/kế hoạch.",
    );
    text("Nghĩa vụ hiện tại", true);
    for (const issue of workspace.issues)
      text(
        `${issue.item_name}${issue.asset_code ? ` · ${issue.asset_code}` : ""}: thực giao ${issue.issued}; đã nhận ${issue.returned}; xử lý không thu hồi ${issue.resolved}; còn phải trả ${issue.due}; hold ${issue.held}. Đơn vị kho: ${issue.base_uom_code}. Mã nguồn: ${issue.id}`,
      );
    for (const event of [...workspace.events].sort(
      (a, b) => a.revision - b.revision,
    )) {
      text(
        `#${event.revision} ${eventLabels[event.operation] ?? event.operation}`,
        true,
      );
      text(`${dateTime.format(new Date(event.occurred_at))} · ${event.reason}`);
      text(`Người ghi nhận / chuyên viên tiếp nhận: ${event.actor_id}`);
      text(`Mã sự kiện: ${event.id}`);
      text(
        event.superseded
          ? "ĐÃ ĐƯỢC ĐÍNH CHÍNH — giữ để tra cứu lịch sử; xem sự kiện thay thế."
          : "Sự kiện hiện hành.",
      );
      if (typeof event.payload.carrier_name === "string")
        text(`Người mang trả: ${event.payload.carrier_name}`);
      for (const line of event.display_lines ?? [])
        text(
          `${effectLabels[line.kind] ?? line.kind}: ${line.item_name}${line.asset_code ? ` · ${line.asset_code}` : ""}; ${line.quantity} ${line.unit}${line.condition ? ` · ${line.condition === "good" ? "tốt" : "hỏng"}` : ""}. Nguồn: ${line.issue_slice_id}`,
        );
      if (!event.display_lines?.length)
        text("Không có dòng chuyển động số lượng.");
      text(`Snapshot SHA-256: ${event.snapshot_hash}`);
      const signature = signatures.find((row) => row.event_id === event.id);
      if (signature) {
        if (signature.snapshot_hash !== event.snapshot_hash)
          throw new Error("SIGNATURE_SNAPSHOT_MISMATCH");
        text(
          `Đã ký: ${signature.actor_id} · ${dateTime.format(new Date(signature.signed_at))}`,
        );
        if (doc.y + 90 > doc.page.height - 50) doc.addPage();
        doc.image(
          Buffer.from(signature.signature.split(",")[1], "base64"),
          40,
          doc.y,
          { fit: [160, 75] },
        );
        doc.moveDown(6);
      } else
        text(
          event.signature_required
            ? "CHƯA KÝ — không trình bày như bằng chứng đã xác nhận."
            : "Không yêu cầu chữ ký riêng.",
        );
    }
    doc.end();
  } catch (error) {
    doc.destroy(error instanceof Error ? error : new Error(String(error)));
  }
  return output;
}
