import { afterEach, describe, expect, it, vi } from "vitest";
import { register } from "@/instrumentation";

/** The server's one word about mail, said once as it starts. */
describe("register", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  function start(env: Record<string, string>) {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("SMTP_URL", env.SMTP_URL ?? "");
    vi.stubEnv("MAIL_FROM", env.MAIL_FROM ?? "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    return { warn, done: register() };
  }

  it("logs one line that says why when SMTP_URL has no MAIL_FROM", async () => {
    const { warn, done } = start({ SMTP_URL: "smtps://u:p@mail.example.com:465" });
    await done;
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("Mail is off: SMTP_URL is set, but MAIL_FROM is not.");
  });

  it("says nothing with neither, and nothing with both", async () => {
    const off = start({});
    await off.done;
    expect(off.warn).not.toHaveBeenCalled();
    vi.restoreAllMocks();

    const on = start({ SMTP_URL: "smtp://127.0.0.1:2525", MAIL_FROM: "board@example.com" });
    await on.done;
    expect(on.warn).not.toHaveBeenCalled();
  });
});
