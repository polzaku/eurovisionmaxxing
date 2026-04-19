import { Suspense } from "react";
import OnboardingForm from "@/components/onboarding/OnboardingForm";

export const metadata = {
  title: "Join — eurovisionmaxxing",
};

export default function OnboardPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center">
      <Suspense fallback={null}>
        <OnboardingForm />
      </Suspense>
    </main>
  );
}
