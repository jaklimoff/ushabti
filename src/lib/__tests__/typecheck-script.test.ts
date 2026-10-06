import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The real scripts run in a small app of their own, so the test needs no
// build, no dev server and no database, and leaves this checkout's .next alone.
const root = join(__dirname, "..", "..", "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

let app: string;

function put(path: string, text: string) {
  mkdirSync(dirname(join(app, path)), { recursive: true });
  writeFileSync(join(app, path), text);
}

// What a build on a branch with one more route leaves behind.
function leaveStaleTypes() {
  put(".next/types/validator.ts", 'export const page = import("../../src/app/gone/page.js");\n');
  put(
    ".next/dev/types/validator.ts",
    'export const page = import("../../../src/app/gone/page.js");\n',
  );
}

function typecheck(): { ok: boolean; out: string } {
  try {
    const out = execFileSync("npm", ["run", "--silent", "typecheck"], {
      cwd: app,
      encoding: "utf8",
      stdio: "pipe",
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
    });
    return { ok: true, out };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return { ok: false, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

beforeAll(() => {
  app = mkdtempSync(join(tmpdir(), "ushabti-typecheck-"));
  symlinkSync(join(root, "node_modules"), join(app, "node_modules"), "dir");
  put(
    "package.json",
    JSON.stringify({
      private: true,
      type: "module",
      scripts: { typecheck: pkg.scripts.typecheck },
    }),
  );
  put("tsconfig.json", readFileSync(join(root, "tsconfig.json"), "utf8"));
  put("tsconfig.e2e.json", readFileSync(join(root, "tsconfig.e2e.json"), "utf8"));
  put("next.config.mjs", "export default {};\n");
  put("e2e/empty.ts", "export {};\n");
  put(
    "src/app/layout.tsx",
    "export default function Layout({ children }: { children: React.ReactNode }) {\n" +
      "  return <html><body>{children}</body></html>;\n}\n",
  );
  put("src/app/page.tsx", "export default function Page() {\n  return <p>Hi</p>;\n}\n");
});

afterAll(() => {
  rmSync(app, { recursive: true, force: true });
});

describe("npm run typecheck", () => {
  it("passes on a branch with fewer routes than the last build saw", () => {
    leaveStaleTypes();
    const run = typecheck();
    expect(run.out).not.toMatch(/gone/);
    expect(run.ok).toBe(true);
  }, 120_000);

  it("still fails on a real type error", () => {
    leaveStaleTypes();
    put("src/wrong.ts", 'export const n: number = "one";\n');
    try {
      const run = typecheck();
      expect(run.ok).toBe(false);
      expect(run.out).toMatch(/src\/wrong\.ts/);
    } finally {
      rmSync(join(app, "src/wrong.ts"));
    }
  }, 120_000);
});
