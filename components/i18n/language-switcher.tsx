"use client";

import { useLanguage } from "./language-provider";
import styles from "./language-switcher.module.css";

export function LanguageSwitcher() {
  const { language, changeLanguage, pending, error } = useLanguage();
  return (
    <div className={styles.root}>
      <div
        className={styles.switch}
        role="group"
        aria-label={
          language === "vi" ? "Ngôn ngữ giao diện" : "Interface language"
        }
        aria-busy={pending}
      >
        {(["vi", "en"] as const).map((choice) => (
          <button
            key={choice}
            type="button"
            lang={choice}
            aria-label={choice === "vi" ? "Tiếng Việt" : "English"}
            aria-pressed={language === choice}
            disabled={pending}
            onClick={() => void changeLanguage(choice)}
          >
            {choice.toUpperCase()}
          </button>
        ))}
      </div>
      {error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}
      <span className="sr-only" role="status">
        {pending
          ? language === "vi"
            ? "Đang chuyển ngôn ngữ…"
            : "Changing language…"
          : ""}
      </span>
    </div>
  );
}
