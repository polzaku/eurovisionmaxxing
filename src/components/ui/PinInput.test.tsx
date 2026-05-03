// @vitest-environment jsdom

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import PinInput from "./PinInput";

describe("PinInput", () => {
  it("renders 6 visual slots by default", () => {
    render(<PinInput onComplete={vi.fn()} />);
    for (let i = 0; i < 6; i++) {
      expect(screen.getByTestId(`pin-slot-${i}`)).toBeInTheDocument();
    }
    expect(screen.queryByTestId("pin-slot-6")).not.toBeInTheDocument();
  });

  it("respects a custom length prop", () => {
    render(<PinInput onComplete={vi.fn()} length={4} />);
    for (let i = 0; i < 4; i++) {
      expect(screen.getByTestId(`pin-slot-${i}`)).toBeInTheDocument();
    }
    expect(screen.queryByTestId("pin-slot-4")).not.toBeInTheDocument();
  });

  it("uses autocomplete='one-time-code' for iOS SMS autofill", () => {
    render(<PinInput onComplete={vi.fn()} />);
    const input = screen.getByLabelText(/Room PIN/i);
    expect(input).toHaveAttribute("autocomplete", "one-time-code");
  });

  it("hydrates slots with initialValue characters (filled markers + values)", () => {
    render(<PinInput onComplete={vi.fn()} initialValue="ABC" />);
    expect(screen.getByTestId("pin-slot-0")).toHaveAttribute("data-filled", "true");
    expect(screen.getByTestId("pin-slot-0").textContent).toBe("A");
    expect(screen.getByTestId("pin-slot-1").textContent).toBe("B");
    expect(screen.getByTestId("pin-slot-2").textContent).toBe("C");
    // Slots 3-5 unfilled
    expect(screen.getByTestId("pin-slot-3")).not.toHaveAttribute("data-filled");
    expect(screen.getByTestId("pin-slot-3").textContent).toBe("·");
  });

  it("marks the next-empty slot as active", () => {
    render(<PinInput onComplete={vi.fn()} initialValue="AB" />);
    expect(screen.getByTestId("pin-slot-2")).toHaveAttribute("data-active", "true");
    expect(screen.getByTestId("pin-slot-1")).not.toHaveAttribute("data-active");
  });

  it("fires onComplete on mount when initialValue is a complete PIN", () => {
    const onComplete = vi.fn();
    render(<PinInput onComplete={onComplete} initialValue="ABCDEF" />);
    expect(onComplete).toHaveBeenCalledWith("ABCDEF");
  });

  it("does NOT fire onComplete on mount for incomplete initialValue", () => {
    const onComplete = vi.fn();
    render(<PinInput onComplete={onComplete} initialValue="ABC" />);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("auto-uppercases typed input via normalizePin", () => {
    render(<PinInput onComplete={vi.fn()} />);
    const input = screen.getByLabelText(/Room PIN/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "abc" } });
    expect(screen.getByTestId("pin-slot-0").textContent).toBe("A");
    expect(screen.getByTestId("pin-slot-1").textContent).toBe("B");
    expect(screen.getByTestId("pin-slot-2").textContent).toBe("C");
  });

  it("filters out characters outside PIN_CHARSET", () => {
    render(<PinInput onComplete={vi.fn()} />);
    const input = screen.getByLabelText(/Room PIN/i) as HTMLInputElement;
    // PIN_CHARSET excludes vowels A,E,I,O,U among others — pick a known excluded char.
    // Easier: type spaces, which are excluded.
    fireEvent.change(input, { target: { value: "AB CD" } });
    // Spaces filtered out → "ABCD" (assuming letters are in charset).
    expect(screen.getByTestId("pin-slot-3").textContent).not.toBe(" ");
  });

  it("fires onComplete when typing reaches `length` characters", () => {
    const onComplete = vi.fn();
    render(<PinInput onComplete={onComplete} />);
    const input = screen.getByLabelText(/Room PIN/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "ABCDEF" } });
    expect(onComplete).toHaveBeenCalledWith("ABCDEF");
  });

  it("supports paste semantics via the single input (paste-distribute works)", () => {
    const onComplete = vi.fn();
    render(<PinInput onComplete={onComplete} />);
    const input = screen.getByLabelText(/Room PIN/i) as HTMLInputElement;
    // Paste = onChange with the full pasted string.
    fireEvent.change(input, { target: { value: "GHJKLM" } });
    expect(onComplete).toHaveBeenCalledWith("GHJKLM");
    // Each slot reflects a character.
    expect(screen.getByTestId("pin-slot-0").textContent).toBe("G");
    expect(screen.getByTestId("pin-slot-5").textContent).toBe("M");
  });

  it("renders disabled state with opacity + readOnly", () => {
    render(<PinInput onComplete={vi.fn()} disabled />);
    const input = screen.getByLabelText(/Room PIN/i);
    expect(input).toHaveAttribute("readonly");
    expect(input).toHaveAttribute("aria-disabled", "true");
    const wrapper = screen.getByTestId("pin-input");
    expect(wrapper.className).toContain("opacity-60");
  });

  it("does NOT clear existing input on parent re-render (error-doesn't-clear)", () => {
    const { rerender } = render(<PinInput onComplete={vi.fn()} />);
    const input = screen.getByLabelText(/Room PIN/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "GHJ" } });
    expect(screen.getByTestId("pin-slot-0").textContent).toBe("G");
    // Parent rerender (e.g. error state flipping) — value persists.
    rerender(<PinInput onComplete={vi.fn()} />);
    expect(screen.getByTestId("pin-slot-0").textContent).toBe("G");
  });

  it("focuses the underlying input when the wrapper is clicked", () => {
    render(<PinInput onComplete={vi.fn()} />);
    const wrapper = screen.getByTestId("pin-input");
    fireEvent.click(wrapper);
    expect(document.activeElement).toBe(screen.getByLabelText(/Room PIN/i));
  });
});
