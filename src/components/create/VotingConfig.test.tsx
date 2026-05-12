// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

import VotingConfig from "./VotingConfig";

afterEach(() => cleanup());

const BASE_PROPS = {
  templateId: "classic" as const,
  announcementMode: "instant" as const,
  announcementStyle: "full" as const,
  allowNowPerforming: false,
  submitState: { kind: "idle" as const },
  onChange: vi.fn(),
  onBack: vi.fn(),
  onSubmit: vi.fn(),
};

describe("VotingConfig — initial render", () => {
  it("renders the template section and announcement section", () => {
    render(<VotingConfig {...BASE_PROPS} onChange={vi.fn()} onBack={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.getByText(/create\.votingConfig\.heading/i)).toBeInTheDocument();
    // "Template" and "Announcement" section label paragraphs
    expect(screen.getByText("create.votingConfig.templateLabel")).toBeInTheDocument();
    expect(screen.getByText("create.votingConfig.announcementLabel")).toBeInTheDocument();
  });

  it("renders the Back and Create room buttons", () => {
    render(<VotingConfig {...BASE_PROPS} onChange={vi.fn()} onBack={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.getByRole("button", { name: /create\.actions\.back/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create\.actions\.createRoom/i })).toBeInTheDocument();
  });

  it("calls onBack when Back is clicked", () => {
    const onBack = vi.fn();
    render(<VotingConfig {...BASE_PROPS} onChange={vi.fn()} onBack={onBack} onSubmit={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /create\.actions\.back/i }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("calls onSubmit when Create room is clicked", () => {
    const onSubmit = vi.fn();
    render(<VotingConfig {...BASE_PROPS} onChange={vi.fn()} onBack={vi.fn()} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("button", { name: /create\.actions\.createRoom/i }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("disables both buttons while submitting", () => {
    render(
      <VotingConfig
        {...BASE_PROPS}
        submitState={{ kind: "submitting" }}
        onChange={vi.fn()}
        onBack={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /create\.actions\.back/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /create\.actions\.creating/i })).toBeDisabled();
  });

  it("renders the error message when submitState is error", () => {
    render(
      <VotingConfig
        {...BASE_PROPS}
        submitState={{ kind: "error", message: "Something went wrong" }}
        onChange={vi.fn()}
        onBack={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/Something went wrong/);
  });
});

describe("VotingConfig — AnnouncementStyleSubRadio visibility", () => {
  it("A — shows the sub-radio when announcementMode is 'live'", () => {
    render(
      <VotingConfig
        {...BASE_PROPS}
        announcementMode="live"
        announcementStyle="full"
        onChange={vi.fn()}
        onBack={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    expect(
      screen.getByTestId("announcement-style-subradio"),
    ).toBeInTheDocument();
  });

  it("B — does NOT show the sub-radio when announcementMode is 'instant'", () => {
    render(
      <VotingConfig
        {...BASE_PROPS}
        announcementMode="instant"
        announcementStyle="full"
        onChange={vi.fn()}
        onBack={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    expect(
      screen.queryByTestId("announcement-style-subradio"),
    ).not.toBeInTheDocument();
  });

  it("C — clicking the Short reveal button fires onChange({ announcementStyle: 'short' })", () => {
    const onChange = vi.fn();
    render(
      <VotingConfig
        {...BASE_PROPS}
        announcementMode="live"
        announcementStyle="full"
        onChange={onChange}
        onBack={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    // The sub-radio renders two buttons labelled by their translation keys.
    // With the mock translator, labels come back as
    // "announcementStyle.short.label" + tagline text concatenated into the
    // button's text content. Find it by the key fragment.
    const buttons = screen.getAllByRole("button");
    const shortBtn = buttons.find((b) =>
      b.textContent?.includes("announcementStyle.short"),
    );
    expect(shortBtn).toBeDefined();
    fireEvent.click(shortBtn!);
    expect(onChange).toHaveBeenCalledWith({ announcementStyle: "short" });
  });
});
