// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import EndVotingModal from "./EndVotingModal";

describe("<EndVotingModal>", () => {
  it("renders nothing when isOpen=false", () => {
    const { container } = render(
      <EndVotingModal isOpen={false} onConfirm={() => {}} onCancel={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders dialog with title + body when open", () => {
    render(
      <EndVotingModal isOpen onConfirm={() => {}} onCancel={() => {}} />,
    );
    expect(
      screen.getByRole("dialog", { name: /end voting\?/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/5-second countdown/i)).toBeInTheDocument();
  });

  it("fires onConfirm when the End voting button is clicked", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <EndVotingModal isOpen onConfirm={onConfirm} onCancel={onCancel} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /^end voting$/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("fires onCancel when the Cancel button is clicked", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <EndVotingModal isOpen onConfirm={onConfirm} onCancel={onCancel} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
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
    expect(screen.getByRole("button", { name: /ending…/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeDisabled();
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
