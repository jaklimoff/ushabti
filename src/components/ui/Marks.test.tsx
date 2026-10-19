/// <reference types="vite/client" />
import { describe, expect, test } from "vitest";
import { render } from "vitest-browser-react";
import icon from "@/app/icon.svg?raw";
import { BrandMark } from "./Marks";

/*
 * The bar used to type a letter U beside a tab that drew a stroke, so a
 * person saw two marks. The bar now draws the path of the icon itself.
 */

const ICON_U = /<path d="([^"]+)"/.exec(icon)![1];

describe("The brand mark", () => {
  for (const size of [16, 18, 22, 32] as const) {
    test(`draws the icon's U at ${size}px`, async () => {
      const { container } = await render(<BrandMark size={size} />);
      const svg = container.querySelector("svg")!;
      expect(svg.getAttribute("aria-hidden")).toBe("true");
      expect(container.textContent).toBe("");
      const box = svg.getBoundingClientRect();
      expect([box.width, box.height]).toEqual([size, size]);

      const unit = size / 32;
      const rect = svg.querySelector("rect")!;
      expect(Number(rect.getAttribute("rx")) * unit).toBeCloseTo(Math.ceil(size / 4));
      expect(rect.getAttribute("fill")).toBe("var(--accent)");

      const path = svg.querySelector("path")!;
      expect(path.getAttribute("d")).toBe(ICON_U);
      expect(path.getAttribute("stroke")).toBe("var(--accent-ink)");
      expect(Number(path.getAttribute("stroke-width")) * unit).toBeGreaterThanOrEqual(1.4);
    });
  }
});
