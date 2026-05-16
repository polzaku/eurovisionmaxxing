import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy — eurovisionmaxxing",
  description: "How eurovisionmaxxing handles your data.",
};

const LAST_UPDATED = "2026-05-16";

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-extrabold tracking-tight emx-wordmark mb-2">
        Privacy
      </h1>
      <p className="text-sm text-muted-foreground mb-8">
        Last updated: {LAST_UPDATED}
      </p>

      <div className="space-y-8 text-base leading-relaxed text-foreground">
        <section className="space-y-3">
          <h2 className="text-xl font-bold">Who runs this site</h2>
          <p>
            This service (&ldquo;eurovisionmaxxing&rdquo;, the
            &ldquo;Service&rdquo;) is operated by Valeriia Kulynych, a
            private individual based in the United Kingdom, as a
            non-commercial fan project. You can contact the operator at{" "}
            <a
              href="mailto:contact@eurovisionmaxxing.com"
              className="underline hover:no-underline"
            >
              contact@eurovisionmaxxing.com
            </a>
            .
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold">What we collect</h2>
          <p>To let you play, the Service stores:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>
              <strong>Display name and avatar seed</strong> you enter when
              joining a room.
            </li>
            <li>
              <strong>Your votes and any &ldquo;hot takes&rdquo;</strong>{" "}
              you submit, plus the room you submitted them in.
            </li>
            <li>
              <strong>A session cookie</strong> that lets the Service
              recognise you as the same person across page loads in the
              same room.
            </li>
            <li>
              <strong>A language preference cookie</strong>{" "}
              (<code>NEXT_LOCALE</code>) and a theme preference stored in
              your browser&apos;s local storage. These are strictly
              functional.
            </li>
            <li>
              <strong>Standard server logs</strong> (IP address, user
              agent, request path, timestamps) recorded by our hosting
              provider for security and abuse prevention.
            </li>
          </ul>
          <p>
            We do <strong>not</strong> ask for your real name, email
            address, phone number, or payment details. We do not use
            third-party analytics, advertising trackers, or social-media
            pixels.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold">Why we collect it</h2>
          <p>
            The data above is processed under{" "}
            <strong>UK GDPR Article 6(1)(b)</strong> (performance of the
            implicit contract to provide the service you&apos;ve asked
            for) and <strong>Article 6(1)(f)</strong> (legitimate interest
            in keeping the Service running and abuse-free). The session
            and locale cookies are strictly necessary and do not require
            consent.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold">Who we share it with</h2>
          <p>
            The Service relies on a small number of sub-processors to
            operate. Each is bound by their own terms and security
            arrangements:
          </p>
          <ul className="list-disc pl-6 space-y-1">
            <li>
              <strong>Vercel Inc.</strong> &mdash; hosting, edge
              compute, request logs.
            </li>
            <li>
              <strong>Supabase Inc.</strong> &mdash; database, realtime
              broadcast, authentication storage.
            </li>
            <li>
              <strong>Cloudflare, Inc.</strong> &mdash; DNS and CDN for
              the public domain.
            </li>
          </ul>
          <p>
            We do not sell, rent, or otherwise share your data with anyone
            outside this list.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold">How long we keep it</h2>
          <p>
            Rooms and the votes inside them are kept indefinitely so you
            can revisit past parties. If you want a room or your
            individual participation deleted, email the address above and
            we will remove it promptly. Server logs from our hosting
            providers are retained per their own policies (typically 30
            days or less).
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold">Your rights</h2>
          <p>
            Under UK GDPR you have the right to access, correct, delete,
            or restrict processing of your personal data, and to lodge a
            complaint with the{" "}
            <a
              href="https://ico.org.uk/make-a-complaint/"
              target="_blank"
              rel="noreferrer noopener"
              className="underline hover:no-underline"
            >
              Information Commissioner&apos;s Office
            </a>
            . Email us to exercise any of these rights.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold">International transfers</h2>
          <p>
            Some of our sub-processors are based in the United States.
            Where data is transferred outside the UK or EEA, it relies on
            the relevant Standard Contractual Clauses or the EU-US Data
            Privacy Framework, as published by each provider.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold">Changes</h2>
          <p>
            If this policy changes, the &ldquo;Last updated&rdquo; date
            above will change with it. Material changes affecting how
            existing data is processed will be flagged on the home page.
          </p>
        </section>
      </div>
    </main>
  );
}
