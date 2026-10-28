import type { Language, Messages } from "./language";

export async function getMessages(language: Language): Promise<Messages> {
  if (language === "en") return (await import("./messages/en")).default;
  return (await import("./messages/vi")).default;
}
