import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The end to end shards run inside the Playwright image, which carries the
 * browser of one Playwright release. A package one release ahead looks for a
 * browser the image does not hold, and every spec fails with a missing path
 * that names neither version. The gate runs this file before any shard starts,
 * so a bump that forgets the tag stops here, with both numbers in one line.
 */
const workflow = readFileSync(
  new URL("../../../.github/workflows/ci.yml", import.meta.url),
  "utf8",
);
const installed: string = JSON.parse(
  readFileSync(
    new URL("../../../node_modules/@playwright/test/package.json", import.meta.url),
    "utf8",
  ),
).version;

/** The text of one job, from its name to the next job or the end. */
function job(name: string): string {
  const start = workflow.indexOf(`\n  ${name}:\n`);
  if (start < 0) return "";
  const rest = workflow.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z][\w-]*:\n/);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

describe(".github/workflows/ci.yml", () => {
  it("runs the end to end tests in the Playwright image of the installed version", () => {
    const tag = job("e2e").match(/mcr\.microsoft\.com\/playwright:v([\d.]+)-noble/)?.[1];
    if (tag !== installed) {
      throw new Error(
        `ci.yml runs the end to end tests in the Playwright ${tag ?? "(no)"} image, but @playwright/test is ${installed}. Change the image tag to v${installed}-noble.`,
      );
    }
  });

  it("runs the unit tests in the same image, because the component tests need its browser", () => {
    const tag = job("gate").match(/mcr\.microsoft\.com\/playwright:v([\d.]+)-noble/)?.[1];
    expect(tag).toBe(installed);
  });

  it("installs no browser and no system package", () => {
    expect(workflow).not.toMatch(/playwright install/);
    expect(workflow).not.toMatch(/install-deps|apt(-get)? install/);
  });

  it("splits the end to end tests into three shards after the gate", () => {
    const e2e = job("e2e");
    expect(e2e).toMatch(/needs: gate\n/);
    expect(e2e).toMatch(/shard: \[1, 2, 3\]/);
    expect(e2e).toContain("--shard=${{ matrix.shard }}/3");
    expect(e2e).toContain("fail-fast: false");
  });

  it("gives every shard its own database, reached by the service name", () => {
    const e2e = job("e2e");
    expect(e2e).toMatch(/services:\n\s+postgres:/);
    expect(e2e).toContain("@postgres:5432/");
  });

  it("names each failed shard's results after the shard", () => {
    expect(job("e2e")).toContain("name: playwright-results-${{ matrix.shard }}");
  });

  it("checks format, lint, types and unit tests once, in the gate", () => {
    for (const step of [
      "format:check",
      "npm run lint",
      "npm run typecheck",
      "npm test",
      "npm run build",
    ]) {
      expect(job("gate")).toContain(step);
      expect(job("e2e")).not.toContain(step);
    }
  });

  it("ends with one job named test that passes only when every other job passed", () => {
    const test = job("test");
    expect(test).toContain("needs: [gate, e2e]");
    expect(test).toContain("if: always()");
    expect(test).toContain('"${{ needs.gate.result }}" = success');
    expect(test).toContain('"${{ needs.e2e.result }}" = success');
  });
});
