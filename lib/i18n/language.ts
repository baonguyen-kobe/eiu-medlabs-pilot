export type Language = "vi" | "en";

export const LANGUAGE_COOKIE = "medlabs-language";
export const DEFAULT_LANGUAGE: Language = "vi";

export function parseLanguage(value: unknown): Language {
  return value === "en" ? "en" : DEFAULT_LANGUAGE;
}

export function languageCookie(language: Language, secure = false): string {
  return `${LANGUAGE_COOKIE}=${parseLanguage(language)}; Path=/; Max-Age=31536000; SameSite=Lax${secure ? "; Secure" : ""}`;
}

export type Messages = Readonly<Record<string, string>>;

// These audited validation wrappers contain another UI error at the indicated
// argument. Other arguments (including an item's name in argument 0) stay data.
const validationArguments: Readonly<Record<string, readonly number[]>> = {
  "Dòng {0}: {1}": [1],
  "Dòng {0} (Hàng thừa): {1}": [1],
  "Số lượng dự kiến không hợp lệ: {0}": [0],
  "Đơn giá không hợp lệ: {0}": [0],
  "Vật tư hóa chất bắt buộc phải xác minh Hạn dùng cụ thể (ngày hoặc tháng) trước khi giải tỏa: {0}":
    [0],
};

/** Called for explicit interface copy only, never arbitrary record contents. */
export function createTranslator(messages: Messages) {
  const templates = Object.entries(messages)
    .filter(([key]) => /\{\d+\}/.test(key) && !key.startsWith("{0}"))
    // Prefer a complete sentence over broad wrappers such as “Row {0}: {1}”.
    .sort(
      ([a], [b]) =>
        b.replace(/\{\d+\}/g, "").length - a.replace(/\{\d+\}/g, "").length,
    )
    .map(([key, translated]) => {
      const indices: number[] = [];
      const escaped = key
        .split(/(\{\d+\})/g)
        .map((part) => {
          const parameter = /^\{(\d+)\}$/.exec(part);
          if (parameter) {
            indices.push(Number(parameter[1]));
            return "([\\s\\S]*?)";
          }
          return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        })
        .join("");
      return { key, pattern: new RegExp(`^${escaped}$`), indices, translated };
    });
  function translate(
    source: string,
    values: readonly unknown[],
    depth: number,
  ): string {
    const key = source.trim().replace(/\s+/g, " ");
    let messageKey = key;
    const hasExactMessage = Object.hasOwn(messages, key);
    let translated = hasExactMessage ? messages[key] : source;
    let parameters = values;
    if (!hasExactMessage && !values.length) {
      for (const template of templates) {
        // Captured names, decimals and identifiers retain their original bytes.
        const match = template.pattern.exec(source.trim());
        if (!match) continue;
        const captured: unknown[] = [];
        template.indices.forEach((index, i) => {
          captured[index] = match[i + 1];
        });
        parameters = captured;
        translated = template.translated;
        messageKey = template.key;
        break;
      }
    }
    const nestedArguments = Object.hasOwn(validationArguments, messageKey)
      ? validationArguments[messageKey]
      : undefined;
    if (depth < 3 && nestedArguments) {
      parameters = [...parameters];
      const nested = parameters as unknown[];
      for (const index of nestedArguments) {
        if (typeof nested[index] === "string") {
          nested[index] = translate(nested[index], [], depth + 1);
        }
      }
    }
    const leading = source.match(/^\s*/)?.[0] ?? "";
    const trailing = source.match(/\s*$/)?.[0] ?? "";
    const text =
      translated === source ? source : leading + translated + trailing;
    return text.replace(/\{(\d+)\}/g, (placeholder, index: string) =>
      Number(index) >= parameters.length
        ? placeholder
        : String(parameters[Number(index)]),
    );
  }
  return (source: string, values: readonly unknown[] = []) =>
    translate(source, values, 0);
}

export type Translator = ReturnType<typeof createTranslator>;
