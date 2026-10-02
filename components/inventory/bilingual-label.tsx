import React from "react";

export function BilingualLabel({
  vi,
  en,
  className = "",
  inline = false,
}: {
  vi: string;
  en: string;
  className?: string;
  inline?: boolean;
}) {
  if (inline) {
    return (
      <span className={`inline-flex items-baseline gap-1.5 ${className}`}>
        <span className="font-semibold text-slate-800">{vi}</span>
        <span className="text-xs text-slate-400 font-normal">({en})</span>
      </span>
    );
  }

  return (
    <div className={`flex flex-col leading-tight ${className}`}>
      <span className="font-semibold text-slate-800">{vi}</span>
      <span className="text-xs text-slate-400 font-normal">{en}</span>
    </div>
  );
}
