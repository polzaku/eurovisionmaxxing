// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import LateJoinerCard from "./LateJoinerCard";

describe("<LateJoinerCard>", () => {
  it("renders the orientation copy", () => {
    render(<LateJoinerCard onDismiss={() => {}} />);
    expect(screen.getByTestId("late-joiner-card")).toBeInTheDocument();
    expect(screen.getByText(/you joined mid-show/i)).toBeInTheDocument();
    expect(screen.getByText(/i missed this/i)).toBeInTheDocument();
  });

  it("fires onDismiss when the close button is clicked", async () => {
    const onDismiss = vi.fn();
    render(<LateJoinerCard onDismiss={onDismiss} />);
    await userEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
