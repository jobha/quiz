import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Quiz",
  description: "Quiz med venner over FaceTime.",
};

// Runs before React hydrates, avoiding a flash of the wrong theme.
const noFlashScript = `
(function () {
  try {
    var stored = localStorage.getItem('quiz:theme');
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var dark = stored === 'dark' || (stored !== 'light' && prefersDark);
    if (dark) document.documentElement.classList.add('dark');
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="no">
      <head>
        <script dangerouslySetInnerHTML={{ __html: noFlashScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
