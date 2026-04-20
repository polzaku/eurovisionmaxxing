import type { Metadata } from "next";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import OnboardingForm from "@/components/onboarding/OnboardingForm";

export async function generateMetadata(): Promise<Metadata> {
  const tCommon = await getTranslations("common");
  return {
    title: `Join — ${tCommon("app.name")}`,
  };
}

export default function OnboardPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center">
      <Suspense fallback={null}>
        <OnboardingForm />
      </Suspense>
    </main>
  );
}
