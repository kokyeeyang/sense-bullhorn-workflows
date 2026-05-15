import type { Metadata } from "next";
import { AppFrame } from "@/components/AppFrame";
import "./globals.css";

export const metadata: Metadata = {
  title: "Workflow Dashboard",
  description: "Operational dashboard for Bullhorn workflow metrics",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <AppFrame>{children}</AppFrame>
      </body>
    </html>
  );
}
