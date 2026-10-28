import type { Metadata, Viewport } from "next";
import "@fontsource/be-vietnam-pro/400.css";
import "@fontsource/be-vietnam-pro/500.css";
import "@fontsource/be-vietnam-pro/600.css";
import "@fontsource/be-vietnam-pro/700.css";
import "@fontsource/be-vietnam-pro/800.css";
import "./globals.css";
import {
  LanguageProvider,
  LocalizedText,
} from "@/components/i18n/language-provider";
import { getInterfaceText, getLanguage } from "@/lib/i18n/server";
import { getMessages } from "@/lib/i18n/messages";
import { DocumentLanguage } from "@/components/i18n/document-language";

export async function generateMetadata(): Promise<Metadata> {
  const text = await getInterfaceText();
  return {
    title: {
      default: "MedLabs Calendar",
      template: "%s · MedLabs Calendar",
    },
    description: text("Đăng ký phòng học và quản lý lịch trực kho"),
  };
}

export const viewport: Viewport = {
  themeColor: "#f8f6f1",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const language = await getLanguage();
  const messages = await getMessages(language);
  return (
    <html lang={language}>
      <body>
        <LanguageProvider initialLanguage={language} initialMessages={messages}>
          <DocumentLanguage />
          <a className="skip-link" href="#main-content">
            <LocalizedText text="Bỏ qua đến nội dung chính" />
          </a>
          <div id="main-content" tabIndex={-1}>
            {children}
          </div>
        </LanguageProvider>
      </body>
    </html>
  );
}
