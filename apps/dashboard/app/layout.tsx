import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Nav } from "./nav";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Animus", template: "%s · Animus" },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="nl">
      <body>
        <div className="shell">
          <Nav />
          <main className="page">{children}</main>
        </div>
      </body>
    </html>
  );
}
