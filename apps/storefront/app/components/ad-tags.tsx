"use client";

import Script from "next/script";
import { useEffect, useState } from "react";

import { consentRequiredFor, readConsent, storeConsent, type AdIds } from "../lib/ad-tracking";

type AdTagsProps = AdIds & {
  /** The business's country; decides whether visitors must opt in before tags load. */
  country: string | null;
};

/**
 * Loads the business's own Meta Pixel and Google tag on the booking pages. Renders nothing when neither
 * is configured. In regions that require it, tags wait for the visitor to accept a small banner.
 */
export function AdTags({ metaPixelId, googleTagId, googleConversionLabel, country }: AdTagsProps) {
  const consentRequired = consentRequiredFor(country);
  const [consent, setConsent] = useState<"granted" | "denied" | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setConsent(readConsent());
    setReady(true);
  }, []);

  useEffect(() => {
    (window as Window & { __bkAdIds?: AdIds }).__bkAdIds = { metaPixelId, googleTagId, googleConversionLabel };
  }, [metaPixelId, googleTagId, googleConversionLabel]);

  if (!metaPixelId && !googleTagId) return null;
  if (!ready) return null;

  const allowed = !consentRequired || consent === "granted";
  const choose = (value: "granted" | "denied") => {
    storeConsent(value);
    setConsent(value);
  };

  return (
    <>
      {allowed && metaPixelId ? (
        <Script id="meta-pixel" strategy="afterInteractive">
          {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${metaPixelId}');fbq('track','PageView');`}
        </Script>
      ) : null}
      {allowed && googleTagId ? (
        <>
          <Script src={`https://www.googletagmanager.com/gtag/js?id=${googleTagId}`} strategy="afterInteractive" />
          <Script id="google-tag" strategy="afterInteractive">
            {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}window.gtag=gtag;gtag('js',new Date());gtag('config','${googleTagId}');`}
          </Script>
        </>
      ) : null}
      {consentRequired && consent === null ? (
        <div className="ad-consent" role="dialog" aria-label="Advertising cookies">
          <p>
            We use advertising cookies to measure which ads lead to bookings. Accept to allow them; booking works
            either way.
          </p>
          <div className="ad-consent__actions">
            <button type="button" className="ghost-link" onClick={() => choose("denied")}>
              Decline
            </button>
            <button type="button" className="store-button" onClick={() => choose("granted")}>
              Accept
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
