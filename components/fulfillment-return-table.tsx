import type { Fulfillment } from "@/lib/equipment-fulfillment";
import { useLanguage } from "@/components/i18n/language-provider";
import { returnEntryError, type ReturnEntry } from "@/lib/inventory/decimal";
import styles from "./equipment-preparation.module.css";

const emptyEntry: ReturnEntry = { good: "", damaged: "" };

export function FulfillmentReturnTable({
  issues,
  locations,
  locationId,
  entries,
  onLocationChange,
  onEntryChange,
}: {
  issues: Fulfillment["issues"];
  locations: Fulfillment["locations"];
  locationId: string;
  entries: Record<string, ReturnEntry>;
  onLocationChange: (locationId: string) => void;
  onEntryChange: (issueId: string, entry: ReturnEntry) => void;
}) {
  const { text } = useLanguage();

  if (!issues.length) {
    return <p className="panel-empty">{text("Không còn hàng cần nhận.")}</p>;
  }

  return (
    <>
      <label>
        {text("Nơi nhận")}
        <select
          className="input-field"
          value={locationId}
          onChange={(event) => onLocationChange(event.target.value)}
        >
          {locations.map((location) => (
            <option key={location.id} value={location.id}>
              {location.name}
              {location.active ? "" : text(" (ngừng hoạt động)")}
            </option>
          ))}
        </select>
      </label>
      <div className="data-panel">
        <div className="responsive-table">
          <table className={`data-table ${styles.returnTable}`}>
            <thead>
              <tr>
                <th scope="col">{text("Hàng")}</th>
                <th scope="col">{text("Đã giao")}</th>
                <th scope="col">{text("Đã nhận")}</th>
                <th scope="col">{text("Còn trả")}</th>
                <th scope="col">{text("Tốt")}</th>
                <th scope="col">{text("Hỏng")}</th>
              </tr>
            </thead>
            <tbody>
              {issues.map((issue) => {
                const entry = entries[issue.id] ?? emptyEntry;
                const error = returnEntryError(entry, issue);
                const name = [issue.item_name, issue.asset_code]
                  .filter(Boolean)
                  .join(" ");
                const cell = (condition: keyof ReturnEntry, label: string) => (
                  <td data-label={text(label)}>
                    <input
                      className="input-field"
                      inputMode="decimal"
                      aria-label={`${text(label)}: ${name}`}
                      aria-invalid={Boolean(error)}
                      value={entry[condition]}
                      onChange={(event) =>
                        onEntryChange(issue.id, {
                          ...entry,
                          [condition]: event.target.value,
                        })
                      }
                    />
                  </td>
                );
                return (
                  <tr key={issue.id}>
                    <th scope="row">
                      {name}
                      {error ? (
                        <span className="form-error">{text(error)}</span>
                      ) : null}
                    </th>
                    <td data-label={text("Đã giao")}>
                      {issue.issued} {issue.base_uom_code}
                    </td>
                    <td data-label={text("Đã nhận")}>{issue.returned}</td>
                    <td data-label={text("Còn trả")}>{issue.due}</td>
                    {cell("good", "Tốt")}
                    {cell("damaged", "Hỏng")}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
