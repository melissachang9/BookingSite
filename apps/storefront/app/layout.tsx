import type { Metadata } from "next";
import type { ReactNode } from "react";

import "@booking/ui-components/styles.css";
import "./globals.css";


export const metadata: Metadata = {
  title: "Brow Beauty Lab Booking",
  description: "Luxury beauty studio booking, intake, deposits, and appointment management.",
};


type RootLayoutProps = {
  children: ReactNode;
};


export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en">
      <body className="storefront-body">{children}</body>
    </html>
  );
}