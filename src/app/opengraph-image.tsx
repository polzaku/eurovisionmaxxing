import { ImageResponse } from "next/og";
import { getTranslations } from "next-intl/server";

export const alt = "eurovisionmaxxing";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpengraphImage() {
  const t = await getTranslations("common");
  const name = t("app.name");
  const tagline = t("app.tagline");
  const features = t("app.featuresLine");

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "80px",
          background:
            "radial-gradient(circle at 25% 20%, #ff2d87 0%, transparent 55%), radial-gradient(circle at 80% 80%, #ffd700 0%, transparent 55%), #0a0a14",
          color: "#ffffff",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            fontSize: 112,
            fontWeight: 800,
            letterSpacing: "-0.03em",
            background: "linear-gradient(90deg, #ffd700, #ff2d87)",
            backgroundClip: "text",
            color: "transparent",
            lineHeight: 1,
            textAlign: "center",
          }}
        >
          {name}
        </div>
        <div
          style={{
            fontSize: 44,
            fontWeight: 600,
            marginTop: 32,
            textAlign: "center",
            maxWidth: 980,
          }}
        >
          {tagline}
        </div>
        <div
          style={{
            fontSize: 28,
            marginTop: 48,
            color: "#c4c4d4",
            textAlign: "center",
          }}
        >
          {features}
        </div>
      </div>
    ),
    { ...size },
  );
}
