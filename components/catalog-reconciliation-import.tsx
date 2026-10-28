"use client";

import { useRef, useState, useTransition } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { UploadCloud } from "@/components/icons";
import { useLanguage } from "@/components/i18n/language-provider";
import { LocalizedText } from "@/components/i18n/language-provider";

type Row = {
  item_name: string;
  commercial_name: string;
  item_type: string | null;
  country_of_origin: string | null;
  manufacturer: string | null;
  model: string | null;
  unit: string;
};
type Preview = { fingerprint: string };
type PreviewResult =
  | { ok: true; preview: Preview }
  | { ok: false; reason: "permission" | "invalid" | "unavailable" };
type PreviewFailureReason = "permission" | "invalid" | "unavailable";
const maxFileBytes = 10 * 1024 * 1024;
const maxRows = 5_000;
const previewPageSize = 25;
const rowCountErrorMessage = "File phải có từ 1 đến 5000 dòng dữ liệu.";
const requiredFieldsErrorMessage =
  "Mỗi dòng cần có Tên thiết bị, Tên thương mại và ĐVT.";
const stalePreviewMessage =
  "Dữ liệu danh mục đã thay đổi. Hãy chọn lại file để xem trước bản mới.";

const normalize = (value: unknown) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("vi")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
const text = (value: unknown) => String(value ?? "").trim() || null;

function safeParserError(error: unknown) {
  return error instanceof Error &&
    [rowCountErrorMessage, requiredFieldsErrorMessage].includes(error.message)
    ? error.message
    : "Không thể đọc file import.";
}

function safeApplyError(message: string) {
  return message.includes("CATALOG_RECONCILIATION_STALE_PREVIEW") ||
    message.includes("Dữ liệu đã thay đổi")
    ? stalePreviewMessage
    : "Không thể áp dụng file import. Dữ liệu không thay đổi.";
}

function safePreviewError(reason: PreviewFailureReason) {
  if (reason === "permission")
    return "Bạn không có quyền kiểm tra danh mục này.";
  if (reason === "invalid")
    return "Dữ liệu trong file không hợp lệ. Vui lòng kiểm tra lại Tên thương mại và các trường bắt buộc.";
  return "Không thể kiểm tra dữ liệu trên máy chủ. Dữ liệu chưa được thay đổi.";
}

export function CatalogReconciliationImport({
  preview,
  apply,
}: {
  preview: (rows: Row[]) => Promise<PreviewResult>;
  apply: (
    rows: Row[],
    fingerprint: string,
  ) => Promise<{ ok: boolean; message: string }>;
}) {
  const { text: uiText } = useLanguage();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [previewPage, setPreviewPage] = useState(0);
  const [plan, setPlan] = useState<Preview | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [modalNotice, setModalNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const resetPreview = () => {
    setRows(null);
    setFileName(null);
    setPlan(null);
    setPreviewPage(0);
    setModalNotice(null);
  };

  async function readFile(file: File | null) {
    if (!file) return;
    if (!/\.(csv|xlsx)$/i.test(file.name))
      return setNotice("Chỉ hỗ trợ file CSV hoặc XLSX.");
    if (file.size > maxFileBytes)
      return setNotice("File import không được lớn hơn 10 MB.");
    try {
      const XLSX = await import("@e965/xlsx");
      const buffer = await file.arrayBuffer();
      const workbook = /\.csv$/i.test(file.name)
        ? XLSX.read(new TextDecoder().decode(buffer), { type: "string" })
        : XLSX.read(buffer, { type: "array" });
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(
        workbook.Sheets[workbook.SheetNames[0]],
        { defval: "", raw: false },
      );
      if (!raw.length || raw.length > maxRows)
        throw new Error(rowCountErrorMessage);
      const parsed = raw.map((source) => {
        const fields = new Map(
          Object.entries(source).map(([key, value]) => [
            normalize(key),
            text(value),
          ]),
        );
        const pick = (...keys: string[]) =>
          keys.map((key) => fields.get(key)).find(Boolean) ?? null;
        const item_name = pick("tenthietbivavattu", "tenthietbi", "itemname");
        const commercial_name = pick("tenthuongmai", "commercialname");
        const unit = pick("dvt", "donvitinh", "unit");
        if (!item_name || !commercial_name || !unit)
          throw new Error(requiredFieldsErrorMessage);
        return {
          item_name,
          commercial_name,
          unit,
          item_type: pick("loai", "itemtype"),
          country_of_origin: pick("nuocsx", "nuocsanxuat", "countryoforigin"),
          manufacturer: pick("hang", "hangsanxuat", "manufacturer"),
          model: pick("model"),
        };
      });
      setRows(parsed);
      setFileName(file.name);
      setPreviewPage(0);
      setPlan(null);
      setNotice(null);
      setModalNotice(null);
      startTransition(async () => {
        try {
          const result = await preview(parsed);
          if (result.ok) {
            setPlan(result.preview);
            return;
          }
          setPlan(null);
          setModalNotice(safePreviewError(result.reason));
        } catch {
          setPlan(null);
          setModalNotice(
            "Không thể kiểm tra dữ liệu trên máy chủ. Dữ liệu chưa được thay đổi.",
          );
        }
      });
    } catch (error) {
      resetPreview();
      setNotice(safeParserError(error));
    }
  }

  return (
    <div className="equipment-import-actions catalog-import-all-action">
      <label
        className="button equipment-import-all"
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            fileInputRef.current?.click();
          }
        }}
      >
        <UploadCloud size={17} />
        {uiText(" Import tất cả")}
        <input
          ref={fileInputRef}
          aria-hidden="true"
          className="sr-only"
          tabIndex={-1}
          type="file"
          accept=".csv,.xlsx"
          onChange={(event) => {
            void readFile(event.target.files?.[0] ?? null);
            event.currentTarget.value = "";
          }}
        />
      </label>
      {notice ? (
        <span className="field-note">
          <LocalizedText text={notice ?? ""} />
        </span>
      ) : null}
      <ConfirmDialog
        open={Boolean(rows && fileName)}
        title={uiText("Import tất cả")}
        description={
          fileName && rows
            ? uiText("{0} · {1} dòng dữ liệu", [fileName, rows.length])
            : ""
        }
        cancelLabel={uiText("Hủy")}
        confirmLabel={uiText("Import tất cả")}
        tone="primary"
        pending={pending}
        confirmDisabled={!plan}
        className="catalog-import-preview-dialog"
        onCancel={resetPreview}
        onConfirm={() =>
          rows &&
          plan &&
          startTransition(async () => {
            try {
              const result = await apply(rows, plan.fingerprint);
              if (result.ok) {
                setNotice(result.message);
                resetPreview();
                window.location.reload();
                return;
              }
              setPlan(null);
              setModalNotice(safeApplyError(result.message));
            } catch {
              setPlan(null);
              setModalNotice(
                "Không thể áp dụng file import. Dữ liệu không thay đổi.",
              );
            }
          })
        }
      >
        <div className="catalog-import-preview">
          {modalNotice ? (
            <p className="action-feedback" role="alert">
              {modalNotice}
            </p>
          ) : null}
          <p className="field-note">
            {uiText("Đây là dữ liệu trong file bạn chuẩn bị import.")}
          </p>
          <div
            className="preview-table-wrap"
            role="region"
            aria-label={uiText("Dữ liệu file import")}
            tabIndex={0}
          >
            <table className="preview-table">
              <thead>
                <tr>
                  <th>{uiText("Tên thiết bị và vật tư")}</th>
                  <th>{uiText("Tên thương mại")}</th>
                  <th>{uiText("Loại")}</th>
                  <th>{uiText("Nước SX")}</th>
                  <th>{uiText("Hãng")}</th>
                  <th>{uiText("Model")}</th>
                  <th>{uiText("ĐVT")}</th>
                </tr>
              </thead>
              <tbody>
                {rows
                  ?.slice(
                    previewPage * previewPageSize,
                    (previewPage + 1) * previewPageSize,
                  )
                  .map((row, index) => (
                    <tr key={`${row.commercial_name}-${index}`}>
                      <td>{row.item_name}</td>
                      <td>{row.commercial_name}</td>
                      <td>{row.item_type ?? "—"}</td>
                      <td>{row.country_of_origin ?? "—"}</td>
                      <td>{row.manufacturer ?? "—"}</td>
                      <td>{row.model ?? "—"}</td>
                      <td>{row.unit}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {rows && rows.length > previewPageSize ? (
            <nav
              className="pagination-controls"
              aria-label={uiText("Phân trang dữ liệu file")}
            >
              <span className="field-note">
                {uiText("Dòng ")}
                {previewPage * previewPageSize + 1}–
                {Math.min((previewPage + 1) * previewPageSize, rows.length)} /{" "}
                {rows.length}
              </span>
              <button
                className="button button-secondary"
                type="button"
                disabled={previewPage === 0}
                onClick={() => setPreviewPage((current) => current - 1)}
              >
                {uiText("Trước")}
              </button>
              <button
                className="button button-secondary"
                type="button"
                disabled={(previewPage + 1) * previewPageSize >= rows.length}
                onClick={() => setPreviewPage((current) => current + 1)}
              >
                {uiText("Sau")}
              </button>
            </nav>
          ) : null}
        </div>
      </ConfirmDialog>
    </div>
  );
}
