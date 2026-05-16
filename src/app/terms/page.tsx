import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms — eurovisionmaxxing",
  description: "Terms of use for eurovisionmaxxing.",
};

const LAST_UPDATED = "2026-05-16";

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-extrabold tracking-tight emx-wordmark mb-2">
        Terms of Use
      </h1>
      <p className="text-sm text-muted-foreground mb-8">
        Last updated: {LAST_UPDATED}
      </p>

      <div className="space-y-8 text-base leading-relaxed text-foreground">
        <section className="space-y-3">
          <h2 className="text-xl font-bold">1. Who you&apos;re dealing with</h2>
          <p>
            &ldquo;eurovisionmaxxing&rdquo; (the &ldquo;Service&rdquo;) is
            a non-commercial fan project operated by Valeriia Kulynych, a
            private individual in the United Kingdom (&ldquo;we&rdquo;,
            &ldquo;us&rdquo;). By using the Service you agree to these
            Terms. If you don&apos;t agree, please don&apos;t use it.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold">2. What the Service is</h2>
          <p>
            The Service lets a group of people host a Eurovision
            watch-party voting room, score performances, and reveal the
            results. It is provided free of charge and is not affiliated
            with, endorsed by, or otherwise connected to the European
            Broadcasting Union, the Eurovision Song Contest, or any
            participating broadcaster. &ldquo;Eurovision&rdquo;,
            &ldquo;Eurovision Song Contest&rdquo; and related marks are
            the property of the EBU.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold">3. Acceptable use</h2>
          <p>When you use the Service, please don&apos;t:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>
              Use display names, hot takes, or other content that
              harasses, defames, threatens, or targets any person or
              group, or that infringes anyone&apos;s rights.
            </li>
            <li>
              Attempt to break, probe, or overload the Service, or to
              access data belonging to other rooms or users.
            </li>
            <li>
              Use automation to flood rooms with votes or accounts.
            </li>
            <li>
              Use the Service to break any law that applies to you.
            </li>
          </ul>
          <p>
            We may remove rooms, votes, display names, or accounts that
            breach these rules, and we may suspend or block access to the
            Service from any address that does so.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold">4. Your content</h2>
          <p>
            You keep ownership of anything you submit (display name,
            votes, hot takes). You grant us a limited, non-exclusive
            licence to store and display it inside the Service for the
            purpose of running your room. We do not claim any further
            rights and do not use your content for marketing.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold">5. Source code &amp; licence</h2>
          <p>
            The Service&apos;s source code is published under the{" "}
            <strong>Business Source License 1.1</strong>, which permits
            personal and non-commercial use of the code itself, and
            converts to Apache License 2.0 on the Change Date stated in
            the{" "}
            <a
              href="https://github.com/polzaku/eurovisionmaxxing/blob/main/LICENSE"
              target="_blank"
              rel="noreferrer noopener"
              className="underline hover:no-underline"
            >
              LICENSE file
            </a>
            . These Terms govern your use of the hosted Service; the
            LICENSE governs your use of the code.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold">6. No warranty</h2>
          <p>
            The Service is provided <strong>&ldquo;as is&rdquo;</strong>{" "}
            and <strong>&ldquo;as available&rdquo;</strong>, without
            warranty of any kind, express or implied, including
            warranties of merchantability, fitness for a particular
            purpose, accuracy, or non-infringement. We do not guarantee
            that the Service will be available, uninterrupted, error
            free, secure, or that your data will never be lost.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold">7. Limitation of liability</h2>
          <p>
            To the maximum extent permitted by law, we will not be liable
            for any indirect, incidental, special, consequential, or
            punitive damages, or for any loss of profits, data, goodwill,
            or other intangible losses arising out of or related to your
            use of the Service. Our total aggregate liability to you for
            any claim arising from these Terms or your use of the Service
            is limited to <strong>GBP 10</strong>. Nothing in these
            Terms limits liability that cannot be limited under
            applicable law (for example, liability for death or personal
            injury caused by negligence, or for fraud).
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold">8. Changes to the Service or these Terms</h2>
          <p>
            We may change, suspend, or discontinue any part of the
            Service at any time, and we may update these Terms. If we
            make material changes to these Terms, the &ldquo;Last
            updated&rdquo; date above will change and we&apos;ll surface
            the update on the home page. Continued use after a change
            means you accept the new Terms.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold">9. Governing law &amp; jurisdiction</h2>
          <p>
            These Terms are governed by the laws of{" "}
            <strong>England and Wales</strong>. Any dispute arising out
            of or in connection with them or your use of the Service is
            subject to the exclusive jurisdiction of the courts of
            England and Wales, except where mandatory consumer-protection
            law in your country of residence entitles you to bring a
            claim locally.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold">10. Contact</h2>
          <p>
            Questions about these Terms or about your data go to{" "}
            <a
              href="mailto:contact@eurovisionmaxxing.com"
              className="underline hover:no-underline"
            >
              contact@eurovisionmaxxing.com
            </a>
            . See also our{" "}
            <Link href="/privacy" className="underline hover:no-underline">
              Privacy Policy
            </Link>
            .
          </p>
        </section>
      </div>
    </main>
  );
}
