// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

import LateJoinerCard from "./LateJoinerCard";

describe("<LateJoinerCard>", () => {
  it("renders the card (using locale key)", () => {
    render(<LateJoinerCard onDismiss={() => {}} />);
    expect(screen.getByTestId("late-joiner-card")).toBeInTheDocument();
    // With next-intl mock, t("body") returns "body"
    expect(screen.getByText("body")).toBeInTheDocument();
  });

  it("fires onDismiss when the close button is clicked", async () => {
    const onDismiss = vi.fn();
    render(<LateJoinerCard onDismiss={onDismiss} />);
    await userEvent.click(screen.getByRole("button", { name: /dismissAria/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
