"use client";

import { useState } from "react";
import { useLanguage } from "@/components/i18n/language-provider";

export type ItemRow = { id: string; name: string; cells: string[] };

export function RequestItemsTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: ItemRow[];
}) {
  const { text } = useLanguage();
  const [search, setSearch] = useState("");
  const needle = search.trim().toLowerCase();
  const shown = needle
    ? rows.filter((row) => row.name.toLowerCase().includes(needle))
    : rows;
  return (
    <>
      {rows.length > 10 ? (
        <div className="kho-card-head">
          <label className="kho-search">
            <span className="sr-only">{text("Tìm thiết bị")}</span>
            <input
              type="search"
              value={search}
              placeholder={text("Tìm thiết bị")}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
        </div>
      ) : null}
      <div className="kho-scroll">
        <table className="data-table records-on-phone">
          <thead>
            <tr>
              <th>{text("Thiết bị")}</th>
              {headers.map((header) => (
                <th key={header}>{text(header)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={row.id}>
                <td data-label={text("Thiết bị")}>{row.name}</td>
                {row.cells.map((cell, index) => (
                  <td key={headers[index]} data-label={text(headers[index])}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length ? null : (
          <p className="panel-empty">{text("Không có thiết bị phù hợp.")}</p>
        )}
      </div>
    </>
  );
}
