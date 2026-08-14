import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VTOUR — виртуальные 3D-туры",
  description: "Публичные страницы 360°-туров по квартирам",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
