import type { ReactNode } from "react";

import "./storefront.css";


export const metadata = {
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