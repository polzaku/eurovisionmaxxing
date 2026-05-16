// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

let mockPathname = "/";
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));

import Footer from "./Footer";

describe("Footer", () => {
  beforeEach(() => {
    mockPathname = "/";
  });

  it("renders the four footer links with the expected hrefs", () => {
    render(<Footer />);
    expect(screen.getByTestId("footer-link-about")).toHaveAttribute(
      "href",
      "/about",
    );
    expect(screen.getByTestId("footer-link-privacy")).toHaveAttribute(
      "href",
      "/privacy",
    );
    expect(screen.getByTestId("footer-link-terms")).toHaveAttribute(
      "href",
      "/terms",
    );
    const source = screen.getByTestId("footer-link-source");
    expect(source).toHaveAttribute(
      "href",
      "https://github.com/polzaku/eurovisionmaxxing",
    );
    expect(source).toHaveAttribute("target", "_blank");
    expect(source).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("interpolates the current year into the copyright string", () => {
    render(<Footer />);
    const year = new Date().getFullYear();
    // useTranslations mock returns `key:{"year":N}` when params are passed.
    expect(
      screen.getByText(`copyright:${JSON.stringify({ year })}`),
    ).toBeInTheDocument();
  });

  it("renders the EBU disclaimer", () => {
    render(<Footer />);
    expect(screen.getByText("disclaimer")).toBeInTheDocument();
  });

  it("suppresses itself on the /present TV route", () => {
    mockPathname = "/room/abc-123/present";
    render(<Footer />);
    expect(screen.queryByTestId("app-footer")).not.toBeInTheDocument();
  });

  it("suppresses itself on nested /present/* routes", () => {
    mockPathname = "/room/abc-123/present/leaderboard";
    render(<Footer />);
    expect(screen.queryByTestId("app-footer")).not.toBeInTheDocument();
  });

  it("renders on regular routes", () => {
    mockPathname = "/room/abc-123";
    render(<Footer />);
    expect(screen.getByTestId("app-footer")).toBeInTheDocument();
  });
});
