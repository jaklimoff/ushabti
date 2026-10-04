import { afterEach, describe, expect, it, vi } from "vitest";
import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { register } from "@/instrumentation";

vi.mock("server-only", () => ({}));

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
    vi.stubEnv("USHABTI_URL", env.USHABTI_URL ?? "");
    for (const name of ["S3_BUCKET", "S3_ACCESS_KEY", "S3_SECRET_KEY"]) {
      vi.stubEnv(name, env[name] ?? "");
    }
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    return { warn, done: register() };
  }

  it("logs one line that says why when SMTP_URL has no MAIL_FROM", async () => {
    const { warn, done } = start({ SMTP_URL: "smtps://u:p@mail.example.com:465" });
    await done;
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("Mail is off: SMTP_URL is set, but MAIL_FROM is not.");
  });

  it("logs one line that says why when S3_BUCKET has no keys", async () => {
    const { warn, done } = start({ S3_BUCKET: "ushabti" });
    await done;
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      "Attachments are off: S3_BUCKET is set, but S3_ACCESS_KEY or S3_SECRET_KEY is not.",
    );
  });

  it("says nothing with neither, and nothing with both", async () => {
    const off = start({});
    await off.done;
    expect(off.warn).not.toHaveBeenCalled();
    vi.restoreAllMocks();

    const on = start({
      SMTP_URL: "smtp://127.0.0.1:2525",
      MAIL_FROM: "board@example.com",
      USHABTI_URL: "https://tasks.example.com",
    });
    await on.done;
    expect(on.warn).not.toHaveBeenCalled();
  });

  it("makes the bucket when attachments are on, and not when they are off", async () => {
    const send = vi.spyOn(S3Client.prototype, "send").mockResolvedValue({} as never);
    const off = start({});
    await off.done;
    await vi.waitFor(() => expect(send).not.toHaveBeenCalled());

    const on = start({ S3_BUCKET: "ushabti", S3_ACCESS_KEY: "k", S3_SECRET_KEY: "s" });
    await on.done;
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send.mock.calls[0][0]).toBeInstanceOf(CreateBucketCommand);
  });

  it("logs one line that says the forgot page is off when mail is on and USHABTI_URL is not", async () => {
    const { warn, done } = start({
      SMTP_URL: "smtp://127.0.0.1:2525",
      MAIL_FROM: "board@example.com",
    });
    await done;
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      "Forgot password is off: mail is on, but USHABTI_URL is not set, so the server does not know the address to put in the link.",
    );
  });
});
