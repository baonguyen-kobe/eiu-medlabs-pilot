"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  createTranslator,
  languageCookie,
  type Language,
  type Messages,
} from "@/lib/i18n/language";
import { getMessages } from "@/lib/i18n/messages";

type LanguageContextValue = {
  language: Language;
  text: ReturnType<typeof createTranslator>;
  pending: boolean;
  error: string;
  changeLanguage: (language: Language) => Promise<void>;
};
const LanguageContext = createContext<LanguageContextValue>({
  language: "vi",
  text: createTranslator({}),
  pending: false,
  error: "",
  changeLanguage: async () => {},
});

export function LanguageProvider({
  initialLanguage,
  initialMessages,
  children,
}: {
  initialLanguage: Language;
  initialMessages: Messages;
  children: ReactNode;
}) {
  const [selection, setSelection] = useState({
    language: initialLanguage,
    messages: initialMessages,
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const text = useMemo(
    () => createTranslator(selection.messages),
    [selection.messages],
  );

  useEffect(() => {
    document.documentElement.lang = selection.language;
  }, [selection.language]);

  async function changeLanguage(language: Language) {
    if (pending || language === selection.language) return;
    setPending(true);
    setError("");
    try {
      const messages = await getMessages(language);
      document.cookie = languageCookie(
        language,
        location.protocol === "https:",
      );
      setSelection({ language, messages });
    } catch {
      setError(
        selection.language === "vi"
          ? "Không tải được ngôn ngữ. Hãy thử lại."
          : "Could not load the language. Please try again.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <LanguageContext
      value={{
        language: selection.language,
        text,
        pending,
        error,
        changeLanguage,
      }}
    >
      {children}
    </LanguageContext>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  return context;
}

/** A client leaf for explicit static copy rendered inside Server Components. */
export function LocalizedText({
  text,
  values,
}: {
  text: string;
  values?: readonly unknown[];
}) {
  const { text: translate } = useLanguage();
  return translate(text, values);
}
