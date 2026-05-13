// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

import CustomTemplateCard from "./CustomTemplateCard";

afterEach(() => cleanup());

const BASE_PROPS = {
  selected: true,
  customCategories: [""],
  onSelect: vi.fn(),
  onChange: vi.fn(),
};

describe("CustomTemplateCard — collapsed state", () => {
  it("renders the name and description when not selected, no editor", () => {
    render(
      <CustomTemplateCard
        {...BASE_PROPS}
        selected={false}
        onSelect={vi.fn()}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText("templates.custom.name")).toBeInTheDocument();
    expect(
      screen.getByText("templates.custom.description"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("create.votingConfig.custom.addCategoryButton"),
    ).not.toBeInTheDocument();
  });

  it("calls onSelect when the card is clicked", () => {
    const onSelect = vi.fn();
    render(
      <CustomTemplateCard
        {...BASE_PROPS}
        selected={false}
        onSelect={onSelect}
        onChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("templates.custom.name"));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});

describe("CustomTemplateCard — expanded editor", () => {
  it("renders 1 row with empty input and the +Add button when selected with one starter row", () => {
    render(<CustomTemplateCard {...BASE_PROPS} onChange={vi.fn()} />);
    const inputs = screen.getAllByPlaceholderText(
      "create.votingConfig.custom.namePlaceholder",
    );
    expect(inputs).toHaveLength(1);
    expect(
      screen.getByText("create.votingConfig.custom.addCategoryButton"),
    ).toBeInTheDocument();
  });

  it("disables the trash button when only one row is present", () => {
    render(<CustomTemplateCard {...BASE_PROPS} onChange={vi.fn()} />);
    const trash = screen.getByRole("button", {
      name: /create\.votingConfig\.custom\.removeAria/i,
    });
    expect(trash).toBeDisabled();
  });

  it("renders the row counter with the right ICU params", () => {
    render(
      <CustomTemplateCard
        {...BASE_PROPS}
        customCategories={["Vocals", "Drama", "Outfit"]}
        onChange={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/create\.votingConfig\.custom\.rowCountLabel.*"count":3.*"max":8/),
    ).toBeInTheDocument();
  });

  it("fires onChange with the updated array when a row's input changes", () => {
    const onChange = vi.fn();
    render(
      <CustomTemplateCard
        {...BASE_PROPS}
        customCategories={["Vo", "Drama"]}
        onChange={onChange}
      />,
    );
    const firstInput = screen.getAllByPlaceholderText(
      "create.votingConfig.custom.namePlaceholder",
    )[0];
    fireEvent.change(firstInput, { target: { value: "Vocals" } });
    expect(onChange).toHaveBeenCalledWith(["Vocals", "Drama"]);
  });

  it("filters out characters outside [A-Za-z0-9 -] on input change", () => {
    const onChange = vi.fn();
    render(
      <CustomTemplateCard
        {...BASE_PROPS}
        customCategories={[""]}
        onChange={onChange}
      />,
    );
    const input = screen.getAllByPlaceholderText(
      "create.votingConfig.custom.namePlaceholder",
    )[0];
    fireEvent.change(input, { target: { value: "Vocals!@#" } });
    expect(onChange).toHaveBeenCalledWith(["Vocals"]);
  });

  it("truncates input to 24 characters", () => {
    const onChange = vi.fn();
    render(
      <CustomTemplateCard
        {...BASE_PROPS}
        customCategories={[""]}
        onChange={onChange}
      />,
    );
    const input = screen.getAllByPlaceholderText(
      "create.votingConfig.custom.namePlaceholder",
    )[0];
    fireEvent.change(input, { target: { value: "A".repeat(30) } });
    expect(onChange).toHaveBeenCalledWith(["A".repeat(24)]);
  });

  it("calls onChange with an appended empty row when +Add is clicked", () => {
    const onChange = vi.fn();
    render(
      <CustomTemplateCard
        {...BASE_PROPS}
        customCategories={["Vocals"]}
        onChange={onChange}
      />,
    );
    fireEvent.click(
      screen.getByText("create.votingConfig.custom.addCategoryButton"),
    );
    expect(onChange).toHaveBeenCalledWith(["Vocals", ""]);
  });

  it("disables +Add when there are 8 rows", () => {
    render(
      <CustomTemplateCard
        {...BASE_PROPS}
        customCategories={[
          "Vocals",
          "Drama",
          "Outfit",
          "Music",
          "Vibes",
          "Energy",
          "Lyrics",
          "Stage",
        ]}
        onChange={vi.fn()}
      />,
    );
    const addBtn = screen.getByText(
      "create.votingConfig.custom.addCategoryButton",
    );
    expect(addBtn).toBeDisabled();
  });

  it("removes a row when trash is clicked (multi-row state)", () => {
    const onChange = vi.fn();
    render(
      <CustomTemplateCard
        {...BASE_PROPS}
        customCategories={["Vocals", "Drama", "Outfit"]}
        onChange={onChange}
      />,
    );
    const trashButtons = screen.getAllByRole("button", {
      name: /create\.votingConfig\.custom\.removeAria/i,
    });
    fireEvent.click(trashButtons[1]);
    expect(onChange).toHaveBeenCalledWith(["Vocals", "Outfit"]);
  });

  it("shows the empty-name error on a row with empty value", () => {
    render(
      <CustomTemplateCard
        {...BASE_PROPS}
        customCategories={["Vocals", ""]}
        onChange={vi.fn()}
      />,
    );
    expect(
      screen.getByText("create.votingConfig.custom.errors.empty"),
    ).toBeInTheDocument();
  });

  it("shows the too-short error on a 1-character row", () => {
    render(
      <CustomTemplateCard
        {...BASE_PROPS}
        customCategories={["A"]}
        onChange={vi.fn()}
      />,
    );
    expect(
      screen.getByText("create.votingConfig.custom.errors.tooShort"),
    ).toBeInTheDocument();
  });

  it("shows the duplicate error on a case-insensitive duplicate row", () => {
    render(
      <CustomTemplateCard
        {...BASE_PROPS}
        customCategories={["Vocals", "VOCALS"]}
        onChange={vi.fn()}
      />,
    );
    expect(
      screen.getByText("create.votingConfig.custom.errors.duplicate"),
    ).toBeInTheDocument();
  });

  it("does not show an error on a valid row", () => {
    render(
      <CustomTemplateCard
        {...BASE_PROPS}
        customCategories={["Vocals", "Drama"]}
        onChange={vi.fn()}
      />,
    );
    expect(
      screen.queryByText("create.votingConfig.custom.errors.empty"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("create.votingConfig.custom.errors.tooShort"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("create.votingConfig.custom.errors.duplicate"),
    ).not.toBeInTheDocument();
  });
});
