"use client";

import { createElement, type JSX } from "react";
import { useLanguage } from "./language-provider";

type Tag =
  | "input"
  | "select"
  | "textarea"
  | "button"
  | "a"
  | "nav"
  | "table"
  | "section"
  | "div"
  | "main"
  | "p"
  | "form"
  | "img";
type TextAttribute = "title" | "placeholder" | "aria-label" | "alt";
type Props = {
  [T in Tag]: {
    as: T;
    textAttributes: readonly TextAttribute[];
  } & JSX.IntrinsicElements[T];
}[Tag];

/** Localizes only explicitly marked static attributes from Server Components. */
export function LocalizedElement({ as, textAttributes, ...props }: Props) {
  const { text } = useLanguage();
  const attributes: Record<string, unknown> = { ...props };
  for (const name of textAttributes) {
    const value = attributes[name];
    if (typeof value === "string") attributes[name] = text(value);
  }
  return createElement(as, attributes);
}
