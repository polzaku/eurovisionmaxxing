// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

import EndVotingModal from "./EndVotingModal";

describe("<EndVotingModal>", () => {
  it("renders nothing when isOpen=false", () => {
    const { container } = render(
      <EndVotingModal isOpen={false} onConfirm={() => {}} onCancel={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders dialog with title + body when open (key form)", () => {
    render(
      <EndVotingModal isOpen onConfirm={() => {}} onCancel={() => {}} />,
    );
    // With mock: aria-labelledby id points to h2 whose text is the key
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    // t("voting.endVoting.modal.title") → "voting.endVoting.modal.title"
    expect(screen.getByText("voting.endVoting.modal.title")).toBeInTheDocument();
    // t("voting.endVoting.modal.body") → "voting.endVoting.modal.body"
    expect(screen.getByText("voting.endVoting.modal.body")).toBeInTheDocument();
  });

  it("fires onConfirm when the confirm button is clicked", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <EndVotingModal isOpen onConfirm={onConfirm} onCancel={onCancel} />,
    );
    // t("voting.endVoting.modal.confirm") → "voting.endVoting.modal.confirm"
    await userEvent.click(screen.getByRole("button", { name: /voting\.endVoting\.modal\.confirm/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("fires onCancel when the cancel button is clicked", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <EndVotingModal isOpen onConfirm={onConfirm} onCancel={onCancel} />,
    );
    // t("voting.endVoting.modal.cancel") → "voting.endVoting.modal.cancel"
    await userEvent.click(screen.getByRole("button", { name: /voting\.endVoting\.modal\.cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("renders busy state and disables both buttons", () => {
    render(
      <EndVotingModal
        isOpen
        busy
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    // t("voting.endVoting.modal.busy") → "voting.endVoting.modal.busy"
    expect(screen.getByRole("button", { name: /voting\.endVoting\.modal\.busy/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /voting\.endVoting\.modal\.cancel/i })).toBeDisabled();
  });

  it("renders error message in an alert when provided", () => {
    render(
      <EndVotingModal
        isOpen
        errorMessage="Network error"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Network error");
  });
});
