import "server-only";
import { cookies } from "next/headers";
import { LANGUAGE_COOKIE, parseLanguage } from "./language";
import { createTranslator } from "./language";
import { getMessages } from "./messages";

export async function getLanguage() {
  return parseLanguage((await cookies()).get(LANGUAGE_COOKIE)?.value);
}

export async function getInterfaceText() {
  return createTranslator(await getMessages(await getLanguage()));
}
