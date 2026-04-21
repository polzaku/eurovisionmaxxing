"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

interface QrCodeProps {
  /** The URL or text to encode. */
  url: string;
  /** Rendered pixel size. Defaults to 256 (SPEC §6.1 Step 3 minimum). */
  size?: number;
  /** Accessible alt text. */
  alt?: string;
  className?: string;
}

/**
 * Client-side QR code. Generates a data URL via the `qrcode` package on
 * mount / when `url` changes; renders an `<img>` at the requested size.
 * While generating, shows a shimmer placeholder at the same dimensions.
 */
export default function QrCode({
  url,
  size = 256,
  alt = "QR code",
  className = "",
}: QrCodeProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(url, {
      width: size,
      margin: 1,
      errorCorrectionLevel: "M",
    })
      .then((result) => {
        if (!cancelled) setDataUrl(result);
      })
      .catch(() => {
        if (!cancelled) setDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [url, size]);

  if (!dataUrl) {
    return (
      <div
        style={{ width: size, height: size }}
        className={`rounded-lg bg-muted animate-shimmer ${className}`}
      />
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={dataUrl}
      width={size}
      height={size}
      alt={alt}
      className={`rounded-lg ${className}`}
    />
  );
}
