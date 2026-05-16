import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About — eurovisionmaxxing",
  description:
    "A small, group-chat-flavoured Eurovision watch-party voting app.",
};

export default function AboutPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16 prose-page">
      <h1 className="text-3xl font-extrabold tracking-tight emx-wordmark mb-6">
        About
      </h1>
      <div className="space-y-5 text-base leading-relaxed text-foreground">
        <p>
          <strong>eurovisionmaxxing</strong> is a small web app for turning
          Eurovision watch parties into a group voting game. You spin up a
          room, your friends join with a PIN, everyone scores each country
          across whichever categories you like, and at the end you do the
          12-points reveal in proper jury fashion.
        </p>
        <p>
          It was built by a fan, for fans &mdash; not by, for, or in
          partnership with the European Broadcasting Union. There are no
          ads, no trackers beyond what&apos;s strictly needed to run the
          app, and no plan to sell your votes to anyone.
        </p>
        <p>
          The source is public under the{" "}
          <Link href="/terms" className="underline hover:no-underline">
            Business Source License 1.1
          </Link>
          . You&apos;re welcome to read it, run it locally, contribute, or
          tell a friend.
        </p>
        <ul className="list-disc pl-6 space-y-1">
          <li>
            Source:{" "}
            <a
              href="https://github.com/polzaku/eurovisionmaxxing"
              target="_blank"
              rel="noreferrer noopener"
              className="underline hover:no-underline"
            >
              github.com/polzaku/eurovisionmaxxing
            </a>
          </li>
          <li>
            Bugs &amp; feature requests:{" "}
            <a
              href="https://github.com/polzaku/eurovisionmaxxing/issues"
              target="_blank"
              rel="noreferrer noopener"
              className="underline hover:no-underline"
            >
              GitHub Issues
            </a>
          </li>
        </ul>
      </div>
    </main>
  );
}
