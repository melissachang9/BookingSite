import type { ReactNode } from "react";

import "./storefront.css";
import "./storefront-v2.css";


export const metadata = {
  title: { default: "Online booking", template: "%s" },
  description: "Book appointments online with required forms, deposits and reminders.",
};


type RootLayoutProps = {
  children: ReactNode;
};


export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@1&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap"
        />
      </head>
      <body className="storefront-body">{children}</body>
    </html>
  );
}