// @vitest-environment jsdom

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import StillToGiveLine from "./StillToGiveLine";

const messages = {
  announcing: {
    stillToGive: {
      label: "Still to give:",
      aria: "Remaining points to award: {remaining}",
    },
  },
};

function renderWithIntl(ui: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

afterEach(() => cleanup());

describe("StillToGiveLine", () => {
  it("renders the label", () => {
    renderWithIntl(<StillToGiveLine currentAnnounceIdx={0} />);
    expect(screen.getByText("Still to give:")).toBeInTheDocument();
  });

  it("renders all 10 points at idx=0, none struck through", () => {
    renderWithIntl(<StillToGiveLine currentAnnounceIdx={0} />);
    for (const p of [1, 2, 3, 4, 5, 6, 7, 8, 10, 12]) {
      const span = screen.getByTestId(`stg-remaining-${p}`);
      expect(span).toBeInTheDocument();
      expect(span).toHaveTextContent(String(p));
    }
    expect(screen.queryByTestId("stg-given-1")).not.toBeInTheDocument();
  });

  it("strikes through given values and bolds remaining at idx=3", () => {
    renderWithIntl(<StillToGiveLine currentAnnounceIdx={3} />);
    for (const p of [1, 2, 3]) {
      const span = screen.getByTestId(`stg-given-${p}`);
      expect(span).toBeInTheDocument();
      expect(span.className).toContain("line-through");
    }
    for (const p of [4, 5, 6, 7, 8, 10, 12]) {
      const span = screen.getByTestId(`stg-remaining-${p}`);
      expect(span).toBeInTheDocument();
      expect(span.className).toContain("font-semibold");
    }
  });

  it("exposes a comma-joined remaining list in aria-label", () => {
    renderWithIntl(<StillToGiveLine currentAnnounceIdx={5} />);
    const line = screen.getByLabelText(
      /Remaining points to award: 6, 7, 8, 10, 12/,
    );
    expect(line).toBeInTheDocument();
  });

  it("renders all-given when idx=10 (no remaining spans)", () => {
    renderWithIntl(<StillToGiveLine currentAnnounceIdx={10} />);
    for (const p of [1, 2, 3, 4, 5, 6, 7, 8, 10, 12]) {
      expect(screen.getByTestId(`stg-given-${p}`)).toBeInTheDocument();
    }
    expect(screen.queryByTestId("stg-remaining-12")).not.toBeInTheDocument();
  });

  it("clamps negative idx — renders everything as remaining", () => {
    renderWithIntl(<StillToGiveLine currentAnnounceIdx={-1} />);
    expect(screen.getByTestId("stg-remaining-1")).toBeInTheDocument();
    expect(screen.queryByTestId("stg-given-1")).not.toBeInTheDocument();
  });
});
