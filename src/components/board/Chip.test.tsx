import { describe, expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import type { CardChip } from "@/lib/card-view";
import { Chip } from "./Chip";

/*
 * A colour, an icon or a face alone names nothing to a newcomer, so a chip
 * that wears no words says what it is the moment it is pointed at. One with
 * words keeps the browser's own tooltip.
 */

const base: CardChip = {
  key: "k",
  item: "p",
  tip: "Priority · Urgent",
  swatch: { color: "#d9534f", round: false },
  icon: null,
  fill: null,
  person: null,
  text: null,
  boxed: false,
  mono: false,
  bar: null,
  bubble: false,
};

describe("A chip with no words", () => {
  test("names its property and value on hover, and nothing is left after", async () => {
    await render(<Chip chip={base} />);
    const chip = page.getByRole("img", { name: "Priority · Urgent" });
    await expect.element(chip).not.toHaveAttribute("title");

    await userEvent.hover(chip);
    const tip = page.getByTestId("chip-tip");
    await expect.element(tip).toBeVisible();
    await expect.element(tip).toHaveTextContent("Priority · Urgent");

    await userEvent.unhover(chip);
    await expect.element(tip).not.toBeInTheDocument();
  });

  test("is drawn on the body, so a card that clips cannot cut it", async () => {
    await render(
      <div style={{ overflow: "hidden", width: 20, height: 20 }}>
        <Chip chip={base} />
      </div>,
    );
    await userEvent.hover(page.getByRole("img", { name: "Priority · Urgent" }));
    const tip = page.getByTestId("chip-tip").element();
    expect(tip.parentElement).toBe(document.body);
  });
});

describe("A chip with words", () => {
  test("keeps the browser's tooltip and draws no tip of its own", async () => {
    await render(<Chip chip={{ ...base, text: "Urgent" }} />);
    const chip = page.getByTestId("card-chip");
    await expect.element(chip).toHaveAttribute("title", "Priority · Urgent");

    await userEvent.hover(chip);
    expect(page.getByTestId("chip-tip").elements()).toHaveLength(0);
  });
});
