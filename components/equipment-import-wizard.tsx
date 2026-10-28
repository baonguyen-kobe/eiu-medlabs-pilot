"use client";

import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  Download,
  FileSpreadsheet,
  UploadCloud,
  X,
} from "@/components/icons";
import { useMemo, useState, useTransition } from "react";
import Papa from "papaparse";
import Link from "next/link";
import {
  importEquipmentRequestRows,
  validateEquipmentImportRows,
  type EquipmentImportResult,
  type EquipmentImportValidationResult,
} from "@/app/equipment/import/actions";
import {
  equipmentImportHeaderLabels,
  normalizeEquipmentImportRowHeaders,
  type EquipmentImportHeader,
} from "@/lib/equipment-import-template";
import {
  equipmentStatusDisplayLabels,
  getEquipmentImportFormatIssues,
  normalizeEquipmentImportRow,
  normalizeEquipmentStatus,
} from "@/lib/equipment-import-values";
import { formatImportDate, normalizeImportTime } from "@/lib/import-values";
import { PaginationControls } from "@/components/pagination-controls";
import { TABLE_PAGE_SIZE, totalPagesFor } from "@/lib/pagination";
import { useLanguage } from "@/components/i18n/language-provider";
import { LocalizedText } from "@/components/i18n/language-provider";

type Row = Record<string, unknown>;
type ValidationRow = EquipmentImportValidationResult["rows"][number];

const visibleHeaders: EquipmentImportHeader[] = [
  "source_code",
  "registrant_name",
  "course_code",
  "semester",
  "schedule_date",
  "class_start_time",
  "room",
  "status",
  "skill_name",
  "item_name",
  "quantity",
];

const requiredHeaders: EquipmentImportHeader[] = [
  "source_code",
  "course_code",
  "semester",
  "schedule_date",
  "class_start_time",
  "room",
  "receive_date",
  "receive_time",
  "return_date",
  "return_time",
  "status",
  "skill_name",
  "item_name",
  "quantity",
];

function displayValue(
  row: Row,
  header: EquipmentImportHeader,
  text: (source: string) => string = (source) => source,
) {
  if (["schedule_date", "receive_date", "return_date"].includes(header)) {
    return formatImportDate(row[header]) || "—";
  }
  if (["class_start_time", "receive_time", "return_time"].includes(header)) {
    return normalizeImportTime(row[header]) ?? String(row[header] || "—");
  }
  if (header === "status") {
    const status = normalizeEquipmentStatus(row[header]);
    return status
      ? text(equipmentStatusDisplayLabels[status])
      : String(row[header] || "—");
  }
  return String(row[header] ?? "").trim() || "—";
}

function statusLabel(status: ValidationRow["status"]) {
  if (status === "duplicate") return "Trùng";
  if (status === "error") return "Cần sửa";
  if (status === "warning") return "Hợp lệ, có lưu ý";
  return "Hợp lệ";
}

function validationMessage(
  review: ValidationRow,
  text: (source: string) => string,
) {
  const messages = [...review.errors, ...review.warnings];
  return messages.length
    ? messages.map((message) => text(message)).join("; ")
    : text("Hợp lệ");
}

function EquipmentImportTable({
  rows,
  validationByRow,
  includedIndexes,
  showValidation = false,
}: {
  rows: Row[];
  validationByRow?: Map<number, ValidationRow>;
  includedIndexes?: number[];
  showValidation?: boolean;
}) {
  const { text: uiText } = useLanguage();

  const indexes = includedIndexes ?? rows.map((_, index) => index);
  const [currentPage, setCurrentPage] = useState(1);
  const safePage = Math.min(
    currentPage,
    totalPagesFor(indexes.length, TABLE_PAGE_SIZE),
  );
  const pageIndexes = indexes.slice(
    (safePage - 1) * TABLE_PAGE_SIZE,
    safePage * TABLE_PAGE_SIZE,
  );
  return (
    <div>
      <div
        className="preview-table-wrap"
        role="region"
        aria-label={uiText("Dữ liệu phiếu thiết bị; vuốt ngang để xem đầy đủ")}
        tabIndex={0}
      >
        <table className="preview-table">
          <thead>
            <tr>
              <th>{uiText("Dòng")}</th>
              {visibleHeaders.map((header) => (
                <th key={header}>
                  {uiText(equipmentImportHeaderLabels[header])}
                </th>
              ))}
              {showValidation ? <th>{uiText("Kiểm tra")}</th> : null}
            </tr>
          </thead>
          <tbody>
            {pageIndexes.map((index) => {
              const review = validationByRow?.get(index + 2);
              const invalid =
                review?.status === "error" || review?.status === "duplicate";
              return (
                <tr className={invalid ? "row-error" : ""} key={index}>
                  <td>{index + 2}</td>
                  {visibleHeaders.map((header) => (
                    <td key={header}>
                      {displayValue(rows[index], header, uiText)}
                    </td>
                  ))}
                  {showValidation ? (
                    <td className="preview-status-cell">
                      {review ? (
                        <>
                          <span
                            className={`preview-status preview-status-${review.status}`}
                          >
                            {uiText(statusLabel(review.status))}
                          </span>
                          <small>{validationMessage(review, uiText)}</small>
                        </>
                      ) : (
                        uiText("Chưa có kết quả")
                      )}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <PaginationControls
        currentPage={safePage}
        totalItems={indexes.length}
        onPageChange={setCurrentPage}
      />
    </div>
  );
}

export function EquipmentImportWizard() {
  const { text: uiText } = useLanguage();

  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [presentHeaders, setPresentHeaders] = useState<EquipmentImportHeader[]>(
    [],
  );
  const [error, setError] = useState("");
  const [step, setStep] = useState(1);
  const [result, setResult] = useState<EquipmentImportResult | null>(null);
  const [validation, setValidation] =
    useState<EquipmentImportValidationResult | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [pending, startTransition] = useTransition();

  async function readFile(file: File) {
    setError("");
    setResult(null);
    setValidation(null);
    if (file.size > 5 * 1024 * 1024) {
      setError("File vượt quá giới hạn 5 MB.");
      return;
    }
    if (!/\.(csv|xlsx)$/i.test(file.name)) {
      setError("Chỉ hỗ trợ file CSV UTF-8 hoặc XLSX.");
      return;
    }
    setFileName(file.name);
    try {
      let parsedRows: Row[];
      if (file.name.toLowerCase().endsWith(".csv")) {
        const parsed = Papa.parse<Row>(await file.text(), {
          header: true,
          skipEmptyLines: true,
        });
        if (parsed.errors.length) throw new Error(parsed.errors[0].message);
        parsedRows = parsed.data;
      } else {
        const XLSX = await import("@e965/xlsx");
        const workbook = XLSX.read(await file.arrayBuffer(), {
          type: "array",
          cellDates: true,
        });
        parsedRows = XLSX.utils.sheet_to_json<Row>(
          workbook.Sheets[workbook.SheetNames[0]],
          { defval: "", raw: true },
        );
      }
      if (parsedRows.length > 500) {
        setRows([]);
        setError(
          `File có ${parsedRows.length} dòng, vượt giới hạn 500 dòng. Vui lòng chia file thành nhiều phần.`,
        );
        return;
      }
      const normalizedHeaderRow = parsedRows[0]
        ? normalizeEquipmentImportRowHeaders(parsedRows[0])
        : {};
      setPresentHeaders(
        Object.keys(normalizedHeaderRow) as EquipmentImportHeader[],
      );
      setRows(parsedRows.map(normalizeEquipmentImportRow));
      setStep(2);
    } catch {
      setRows([]);
      setPresentHeaders([]);
      setError(
        "Không thể đọc file. Hãy tải lại template và kiểm tra định dạng.",
      );
    }
  }

  const missingHeaders = useMemo(() => {
    const present = new Set(presentHeaders);
    const missing = requiredHeaders
      .filter((header) => !present.has(header))
      .map((header) => equipmentImportHeaderLabels[header]);
    if (!present.has("registrant_name") && !present.has("registrant_email")) {
      missing.push("Người đăng ký hoặc Email người đăng ký");
    }
    if (!present.has("responsible_name") && !present.has("responsible_email")) {
      missing.push("Giảng viên phụ trách hoặc Email giảng viên phụ trách");
    }
    return missing;
  }, [presentHeaders]);
  const localReviews = useMemo(
    () => rows.map(getEquipmentImportFormatIssues),
    [rows],
  );
  const preliminaryInvalidRows = localReviews.filter(
    (issues) => issues.length,
  ).length;
  const validationByRow = useMemo(
    () => new Map(validation?.rows.map((row) => [row.rowNumber, row]) ?? []),
    [validation],
  );
  const creatableIndexes = useMemo(
    () =>
      validation?.rows
        .filter(({ status }) => status === "valid" || status === "warning")
        .map(({ rowNumber }) => rowNumber - 2) ?? [],
    [validation],
  );
  const creatableRequestCount = useMemo(
    () =>
      new Set(
        creatableIndexes.map((index) => String(rows[index]?.source_code ?? "")),
      ).size,
    [creatableIndexes, rows],
  );

  function resetImport() {
    setRows([]);
    setPresentHeaders([]);
    setFileName("");
    setResult(null);
    setValidation(null);
    setError("");
    setStep(1);
  }

  function runValidation() {
    setError("");
    startTransition(async () => {
      try {
        const next = await validateEquipmentImportRows(JSON.stringify(rows));
        setValidation(next);
        if (next.ok) {
          setRows(next.normalizedRows);
          setStep(3);
        } else {
          setError(next.message);
        }
      } catch {
        setError("Không thể kiểm tra dữ liệu với máy chủ. Vui lòng thử lại.");
      }
    });
  }

  function completeImport() {
    setError("");
    startTransition(async () => {
      try {
        const next = await importEquipmentRequestRows(
          fileName,
          JSON.stringify(rows),
        );
        setResult(next);
        if (next.ok) setStep(5);
        else setError(next.message);
      } catch {
        setError(
          "Không thể kết nối tới máy chủ import. Dữ liệu chưa được gửi lại; vui lòng thử lại.",
        );
      }
    });
  }

  function downloadIssues() {
    if (!result?.issues?.length) return;
    const escape = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const lines = [
      ["Dòng", "Mã phiếu", "Lỗi", "Cảnh báo"].map(escape).join(","),
      ...result.issues.map((issue) =>
        [
          String(issue.rowNumber),
          issue.requestCode,
          issue.errors.join("; "),
          issue.warnings.join("; "),
        ]
          .map(escape)
          .join(","),
      ),
    ];
    const url = URL.createObjectURL(
      new Blob([`\uFEFF${lines.join("\r\n")}`], {
        type: "text/csv;charset=utf-8",
      }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "loi-import-phieu-thiet-bi.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const canCreate = creatableRequestCount > 0;

  return (
    <div className="import-layout embedded">
      <ol className="stepper">
        {[
          uiText("Chọn file"),
          uiText("Xem trước"),
          uiText("Kiểm tra"),
          uiText("Xác nhận"),
          uiText("Kết quả"),
        ].map((label, index) => (
          <li className={step >= index + 1 ? "active" : ""} key={label}>
            <span>{step > index + 1 ? <Check size={14} /> : index + 1}</span>
            <b>{label}</b>
          </li>
        ))}
      </ol>

      {step === 1 ? (
        <section className="import-panel">
          <label
            className={`drop-zone ${dragActive ? "drag-active" : ""}`}
            htmlFor="equipment-import-file"
            onDragEnter={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
              setDragActive(true);
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              if (
                !event.currentTarget.contains(
                  event.relatedTarget as Node | null,
                )
              ) {
                setDragActive(false);
              }
            }}
            onDrop={(event) => {
              event.preventDefault();
              setDragActive(false);
              const file = event.dataTransfer.files?.[0];
              if (file) void readFile(file);
            }}
          >
            <span>
              <UploadCloud size={28} />
            </span>
            <strong>{uiText("Chọn hoặc kéo thả file vào đây")}</strong>
            <small>{uiText("Hỗ trợ CSV UTF-8 và XLSX, tối đa 5 MB")}</small>
          </label>
          <input
            id="equipment-import-file"
            hidden
            type="file"
            accept=".csv,.xlsx"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) void readFile(file);
            }}
          />
          {error ? (
            <p className="form-error">
              <AlertTriangle size={15} /> <LocalizedText text={error ?? ""} />
            </p>
          ) : null}
        </section>
      ) : step === 5 && result ? (
        <section className="import-panel import-result">
          <span className="result-icon">
            <Check size={30} />
          </span>
          <h2>{uiText("Import đã hoàn tất")}</h2>
          <p>
            <LocalizedText text={result.message ?? ""} />
          </p>
          <div className="import-stats">
            <article>
              <span>{uiText("Tổng phiếu")}</span>
              <strong>{result.totalRequests}</strong>
            </article>
            <article>
              <span>{uiText("Đã tạo phiếu")}</span>
              <strong>{result.importedRequests}</strong>
            </article>
            <article>
              <span>{uiText("Dòng thiết bị đã tạo")}</span>
              <strong>{result.importedRows}</strong>
            </article>
            <article className="danger">
              <span>{uiText("Lỗi / trùng")}</span>
              <strong>
                {(result.errorRows ?? 0) + (result.duplicateRows ?? 0)}
              </strong>
            </article>
          </div>
          {result.issues?.length ? (
            <div className="import-issues" role="alert">
              <strong>
                {uiText("Tổng hợp các dòng không được tạo hoặc có lưu ý")}
              </strong>
              <ul>
                {result.issues.slice(0, 12).map((issue, index) => (
                  <li key={`${issue.requestCode}-${issue.rowNumber}-${index}`}>
                    <b>
                      {uiText("Dòng ")}
                      {issue.rowNumber}
                      {uiText(" · Phiếu ")}
                      {issue.requestCode || "—"}
                    </b>
                    {issue.errors.length
                      ? `: ${issue.errors.map((message) => uiText(message)).join("; ")}`
                      : ""}
                    {issue.warnings.length
                      ? ` — ${issue.warnings.map((message) => uiText(message)).join("; ")}`
                      : ""}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <small className="mono">
            {uiText("Mã phiên: ")}
            {result.batchId}
          </small>
          <small className="import-duration">
            {uiText("Thời gian xử lý:")}{" "}
            {((result.durationMs ?? 0) / 1000).toLocaleString("vi-VN", {
              maximumFractionDigits: 1,
            })}{" "}
            {uiText("giây")}
          </small>
          <div className="import-footer centered">
            {result.issues?.length ? (
              <button
                className="button button-secondary"
                onClick={downloadIssues}
              >
                <Download size={16} />
                {uiText(" Tải file lỗi / cảnh báo")}
              </button>
            ) : null}
            <button className="button button-secondary" onClick={resetImport}>
              {uiText("Import file khác")}
            </button>
            <Link className="button button-primary" href="/equipment/requests">
              {uiText("Xem phiếu đã tạo ")}
              <ArrowRight size={16} />
            </Link>
          </div>
        </section>
      ) : (
        <section className="import-panel">
          <div className="file-summary">
            <span>
              <FileSpreadsheet size={22} />
            </span>
            <div>
              <strong>{fileName}</strong>
              <small>
                {step === 2
                  ? uiText("{0} dòng được đọc để xem trước", [rows.length])
                  : step === 3
                    ? uiText("Đã kiểm tra {0} dòng thuộc {1} phiếu", [
                        rows.length,
                        validation?.totalRequests ?? 0,
                      ])
                    : uiText("{0} phiếu sẽ được tạo", [creatableRequestCount])}
              </small>
            </div>
            <button aria-label={uiText("Chọn file khác")} onClick={resetImport}>
              <X size={17} />
            </button>
          </div>

          {step === 2 ? (
            <>
              <div className="import-stats">
                <article>
                  <span>{uiText("Tổng dòng")}</span>
                  <strong>{rows.length}</strong>
                </article>
                <article>
                  <span>{uiText("Đủ dữ liệu sơ bộ")}</span>
                  <strong>
                    {Math.max(0, rows.length - preliminaryInvalidRows)}
                  </strong>
                </article>
                <article className="warning">
                  <span>{uiText("Cần bổ sung")}</span>
                  <strong>{preliminaryInvalidRows}</strong>
                </article>
                <article className={missingHeaders.length ? "danger" : ""}>
                  <span>{uiText("Thiếu cột")}</span>
                  <strong>{missingHeaders.length}</strong>
                </article>
              </div>
              {missingHeaders.length ? (
                <p className="inline-warning">
                  <AlertTriangle size={16} />
                  {uiText(" File đang thiếu:")} {missingHeaders.join(", ")}.
                </p>
              ) : null}
              <EquipmentImportTable rows={rows} />
            </>
          ) : null}

          {step === 3 && validation ? (
            <>
              <div className="import-stats">
                <article>
                  <span>{uiText("Tổng phiếu")}</span>
                  <strong>{validation.totalRequests}</strong>
                </article>
                <article>
                  <span>{uiText("Có thể tạo")}</span>
                  <strong>{validation.creatableRequests}</strong>
                </article>
                <article className="danger">
                  <span>{uiText("Dòng cần sửa")}</span>
                  <strong>{validation.errorRows}</strong>
                </article>
                <article className="warning">
                  <span>{uiText("Dòng trùng")}</span>
                  <strong>{validation.duplicateRows}</strong>
                </article>
              </div>
              <p className="import-step-note">
                {uiText(
                  "Các dòng cùng mã phiếu được kiểm tra chung. Phiếu có bất kỳ dòng lỗi nào sẽ không được tạo.",
                )}
              </p>
              <EquipmentImportTable
                rows={rows}
                validationByRow={validationByRow}
                showValidation
              />
            </>
          ) : null}

          {step === 4 && validation ? (
            <>
              <div className="import-stats">
                <article>
                  <span>{uiText("Tổng phiếu ban đầu")}</span>
                  <strong>{validation.totalRequests}</strong>
                </article>
                <article>
                  <span>{uiText("Sẽ tạo phiếu")}</span>
                  <strong>{creatableRequestCount}</strong>
                </article>
                <article>
                  <span>{uiText("Dòng thiết bị")}</span>
                  <strong>{creatableIndexes.length}</strong>
                </article>
                <article className="danger">
                  <span>{uiText("Dòng bị loại")}</span>
                  <strong>
                    {validation.errorRows + validation.duplicateRows}
                  </strong>
                </article>
              </div>
              <p className="import-step-note">
                {uiText(
                  "Danh sách dưới đây chỉ còn các phiếu hợp lệ có thể tạo mới.",
                )}
              </p>
              {canCreate ? (
                <EquipmentImportTable
                  rows={rows}
                  includedIndexes={creatableIndexes}
                />
              ) : (
                <p className="inline-warning">
                  <AlertTriangle size={16} />
                  {uiText(" Không có phiếu hợp lệ để tạo.")}
                </p>
              )}
            </>
          ) : null}

          {error ? (
            <p className="form-error">
              <AlertTriangle size={15} /> <LocalizedText text={error ?? ""} />
            </p>
          ) : null}
          <div className="import-footer">
            <button
              className="button button-secondary"
              disabled={pending}
              onClick={() => setStep(Math.max(1, step - 1))}
            >
              <ArrowLeft size={16} />
              {uiText(" Quay lại")}
            </button>
            <button
              className="button button-primary"
              disabled={
                pending ||
                missingHeaders.length > 0 ||
                rows.length === 0 ||
                (step === 4 && !canCreate)
              }
              onClick={() => {
                if (step === 2) runValidation();
                else if (step === 3) setStep(4);
                else completeImport();
              }}
            >
              {pending
                ? step === 2
                  ? uiText("Đang kiểm tra…")
                  : uiText("Đang tạo phiếu…")
                : step === 4
                  ? uiText("Tạo phiếu")
                  : uiText("Tiếp tục")}{" "}
              <ArrowRight size={16} />
            </button>
          </div>
          {pending ? (
            <p className="import-progress" role="status">
              {step === 2
                ? uiText(
                    "Đang đối chiếu lớp, nhân sự và danh mục cho {0} dòng…",
                    [rows.length],
                  )
                : uiText("Đang tạo {0} phiếu hợp lệ…", [creatableRequestCount])}
            </p>
          ) : null}
        </section>
      )}
    </div>
  );
}
