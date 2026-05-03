// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

import FullscreenPrompt from "./FullscreenPrompt";

describe("FullscreenPrompt", () => {
  let originalRequestFullscreen: unknown;

  beforeEach(() => {
    originalRequestFullscreen = (
      document.documentElement as unknown as {
        requestFullscreen?: unknown;
      }
    ).requestFullscreen;
    // jsdom doesn't implement requestFullscreen — install a stub.
    Object.defineProperty(document.documentElement, "requestFullscreen", {
      configurable: true,
      writable: true,
      value: vi.fn().mockResolvedValue(undefined),
    });
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      writable: true,
      value: null,
    });
  });

  afterEach(() => {
    Object.defineProperty(document.documentElement, "requestFullscreen", {
      configurable: true,
      value: originalRequestFullscreen,
    });
  });

  it("renders the prompt when not in fullscreen and the API is supported", () => {
    render(<FullscreenPrompt />);
    expect(screen.getByTestId("fullscreen-prompt")).toBeInTheDocument();
  });

  it("renders nothing when the Fullscreen API is unsupported", () => {
    // Remove the requestFullscreen function.
    Object.defineProperty(document.documentElement, "requestFullscreen", {
      configurable: true,
      writable: true,
      value: undefined,
    });
    render(<FullscreenPrompt />);
    expect(screen.queryByTestId("fullscreen-prompt")).not.toBeInTheDocument();
  });

  it("renders nothing when already in fullscreen", () => {
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      writable: true,
      value: document.documentElement,
    });
    render(<FullscreenPrompt />);
    expect(screen.queryByTestId("fullscreen-prompt")).not.toBeInTheDocument();
  });

  it("calls requestFullscreen when 'Enter fullscreen' is clicked", () => {
    render(<FullscreenPrompt />);
    fireEvent.click(screen.getByText("present.fullscreen.enter"));
    expect(
      document.documentElement.requestFullscreen,
    ).toHaveBeenCalledTimes(1);
  });

  it("hides the prompt when the dismiss × button is tapped", () => {
    render(<FullscreenPrompt />);
    fireEvent.click(
      screen.getByRole("button", { name: "present.fullscreen.dismissAria" }),
    );
    expect(screen.queryByTestId("fullscreen-prompt")).not.toBeInTheDocument();
  });

  it("re-renders the prompt when the document exits fullscreen", () => {
    render(<FullscreenPrompt />);
    expect(screen.getByTestId("fullscreen-prompt")).toBeInTheDocument();
    // Simulate entering fullscreen (the prompt should hide).
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      writable: true,
      value: document.documentElement,
    });
    act(() => {
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    expect(screen.queryByTestId("fullscreen-prompt")).not.toBeInTheDocument();
    // Now exit fullscreen — the prompt should come back.
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      writable: true,
      value: null,
    });
    act(() => {
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    expect(screen.getByTestId("fullscreen-prompt")).toBeInTheDocument();
  });

  it("survives a requestFullscreen rejection without crashing", async () => {
    Object.defineProperty(document.documentElement, "requestFullscreen", {
      configurable: true,
      writable: true,
      value: vi.fn().mockRejectedValue(new Error("user-rejected")),
    });
    render(<FullscreenPrompt />);
    fireEvent.click(screen.getByText("present.fullscreen.enter"));
    // No throw, prompt still rendered.
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId("fullscreen-prompt")).toBeInTheDocument();
  });
});
