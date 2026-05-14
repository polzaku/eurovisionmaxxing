// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DrillDownSheet from "@/components/results/drill-down/DrillDownSheet";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("<DrillDownSheet>", () => {
  it("renders nothing when open is false", () => {
    const { container } = render(
      <DrillDownSheet
        open={false}
        onClose={() => {}}
        titleId="t"
        closeAriaLabel="Close"
      >
        <h2 id="t">Title</h2>
      </DrillDownSheet>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a dialog with aria-modal + aria-labelledby when open", () => {
    render(
      <DrillDownSheet
        open
        onClose={() => {}}
        titleId="t1"
        closeAriaLabel="Close"
      >
        <h2 id="t1">Contestant: Sweden</h2>
      </DrillDownSheet>,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-labelledby", "t1");
  });

  it("ESC key calls onClose", () => {
    const onClose = vi.fn();
    render(
      <DrillDownSheet open onClose={onClose} titleId="t" closeAriaLabel="Close">
        <h2 id="t">x</h2>
      </DrillDownSheet>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("backdrop click calls onClose; panel click does not", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <DrillDownSheet open onClose={onClose} titleId="t" closeAriaLabel="Close">
        <h2 id="t">x</h2>
      </DrillDownSheet>,
    );
    await user.click(screen.getByTestId("drill-down-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.click(screen.getByTestId("drill-down-panel"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("X button calls onClose", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <DrillDownSheet
        open
        onClose={onClose}
        titleId="t"
        closeAriaLabel="Close drill-down"
      >
        <h2 id="t">x</h2>
      </DrillDownSheet>,
    );
    await user.click(
      screen.getByRole("button", { name: "Close drill-down" }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("focus lands on the close button when opened", () => {
    render(
      <DrillDownSheet open onClose={() => {}} titleId="t" closeAriaLabel="Close">
        <h2 id="t">x</h2>
      </DrillDownSheet>,
    );
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
  });

  it("focus restores to the previously focused element when closed", () => {
    const trigger = document.createElement("button");
    trigger.textContent = "Open";
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const { rerender } = render(
      <DrillDownSheet open onClose={() => {}} titleId="t" closeAriaLabel="Close">
        <h2 id="t">x</h2>
      </DrillDownSheet>,
    );
    rerender(
      <DrillDownSheet
        open={false}
        onClose={() => {}}
        titleId="t"
        closeAriaLabel="Close"
      >
        <h2 id="t">x</h2>
      </DrillDownSheet>,
    );
    expect(document.activeElement).toBe(trigger);
  });

  it("panel has motion-safe fade-in animation class", () => {
    render(
      <DrillDownSheet open onClose={() => {}} titleId="t" closeAriaLabel="Close">
        <h2 id="t">x</h2>
      </DrillDownSheet>,
    );
    expect(screen.getByTestId("drill-down-panel").className).toMatch(
      /motion-safe:animate-fade-in|animate-fade-in/,
    );
  });
});
