// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import AnnouncementStyleSubRadio from "./AnnouncementStyleSubRadio";

const messages = {
  announcementStyle: {
    subradioLabel: "Reveal style",
    full: {
      label: "Full reveal",
      tagline: "Each spokesperson reveals all 10 points live, 1 through 12.",
    },
    short: {
      label: "Short reveal — Eurovision style",
      tagline: "Only the 12-point reveal is live. Lower scores tick on automatically.",
      tooltip: "Just like the real Eurovision: only 12-point reveals are live, the rest tick on automatically. Best on a TV with everyone watching.",
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

describe("AnnouncementStyleSubRadio", () => {
  it("renders both options with correct labels and aria-pressed state", () => {
    renderWithIntl(
      <AnnouncementStyleSubRadio value="full" onChange={vi.fn()} />,
    );
    const buttons = screen.getAllByRole("button", { hidden: false });
    // First two buttons should be the style options (not the info button)
    const fullBtn = buttons.find((b) => b.textContent?.includes("Full reveal"));
    const shortBtn = buttons.find((b) => b.textContent?.includes("Short reveal"));
    expect(fullBtn).toHaveAttribute("aria-pressed", "true");
    expect(shortBtn).toHaveAttribute("aria-pressed", "false");
  });

  it("fires onChange with 'short' when the short option is clicked", () => {
    const onChange = vi.fn();
    renderWithIntl(
      <AnnouncementStyleSubRadio value="full" onChange={onChange} />,
    );
    const buttons = screen.getAllByRole("button");
    const shortBtn = buttons.find((b) => b.textContent?.includes("Short reveal"));
    fireEvent.click(shortBtn!);
    expect(onChange).toHaveBeenCalledWith("short");
  });

  it("toggles tooltip visibility via the info button", () => {
    renderWithIntl(
      <AnnouncementStyleSubRadio value="full" onChange={vi.fn()} />,
    );
    expect(screen.queryByText(/Just like the real Eurovision/)).toBeNull();
    // aria-label is now the subradioLabel key ("Reveal style" from messages fixture)
    fireEvent.click(
      screen.getByRole("button", { name: /Reveal style/i }),
    );
    expect(screen.getByText(/Just like the real Eurovision/)).toBeInTheDocument();
  });

  it("suppresses onChange when disabled", () => {
    const onChange = vi.fn();
    renderWithIntl(
      <AnnouncementStyleSubRadio value="full" onChange={onChange} disabled />,
    );
    const buttons = screen.getAllByRole("button");
    const shortBtn = buttons.find((b) => b.textContent?.includes("Short reveal"));
    fireEvent.click(shortBtn!);
    expect(onChange).not.toHaveBeenCalled();
  });
});
