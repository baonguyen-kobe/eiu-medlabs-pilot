"use client";
import { useLanguage } from "@/components/i18n/language-provider";

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
  const { language } = useLanguage();
  return (
    <span
      className={`${inline ? "inline" : "block"} font-semibold leading-tight ${className}`}
    >
      {language === "en" ? en : vi}
    </span>
  );
}
