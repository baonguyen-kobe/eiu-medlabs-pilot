"use client";

import Image, { type ImageProps } from "next/image";
import { useLanguage } from "./language-provider";

/** Only for images whose alt is interface copy, rather than record content. */
export function LocalizedImage(props: ImageProps) {
  const { text } = useLanguage();
  return <Image {...props} alt={text(props.alt)} />;
}
