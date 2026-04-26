import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Quiz",
  description: "Quiz med venner over FaceTime.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="no">
      <body>{children}</body>
    </html>
  );
}
