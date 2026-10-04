import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";

vi.mock("server-only", () => ({}));

import { ensureBucket } from "@/lib/storage";

/** The app makes its own bucket, so a fresh store needs no helper container. */
describe("ensureBucket", () => {
  beforeEach(() => {
    vi.stubEnv("S3_ENDPOINT", "http://localhost:9050");
    vi.stubEnv("S3_REGION", "us-east-1");
    vi.stubEnv("S3_BUCKET", "ushabti");
    vi.stubEnv("S3_ACCESS_KEY", "ushabti");
    vi.stubEnv("S3_SECRET_KEY", "ushabti-secret");
    vi.stubEnv("S3_FORCE_PATH_STYLE", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  function refusal(name: string, status?: number) {
    return Object.assign(new Error(name), {
      name,
      $metadata: status ? { httpStatusCode: status } : {},
    });
  }

  it("asks for the bucket once, by its name", async () => {
    const send = vi.spyOn(S3Client.prototype, "send").mockResolvedValue({} as never);
    await ensureBucket();
    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls[0][0] as CreateBucketCommand;
    expect(command).toBeInstanceOf(CreateBucketCommand);
    expect(command.input).toEqual({ Bucket: "ushabti" });
  });

  it.each(["BucketAlreadyOwnedByYou", "BucketAlreadyExists"])(
    "takes %s as success and says nothing",
    async (name) => {
      const send = vi.spyOn(S3Client.prototype, "send").mockRejectedValue(refusal(name, 409));
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      await ensureBucket();
      expect(send).toHaveBeenCalledTimes(1);
      expect(warn).not.toHaveBeenCalled();
    },
  );

  it("asks again while the store does not answer, and stops once it does", async () => {
    const send = vi
      .spyOn(S3Client.prototype, "send")
      .mockRejectedValueOnce(refusal("ECONNREFUSED"))
      .mockRejectedValueOnce(refusal("ECONNREFUSED"))
      .mockResolvedValue({} as never);
    await ensureBucket({ tries: 5, waitMs: 1 });
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("asks again while a starting store answers 5xx", async () => {
    const send = vi
      .spyOn(S3Client.prototype, "send")
      .mockRejectedValueOnce(refusal("ServiceUnavailable", 503))
      .mockResolvedValue({} as never);
    await ensureBucket({ tries: 5, waitMs: 1 });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("logs one line and does not throw when the store refuses", async () => {
    const send = vi
      .spyOn(S3Client.prototype, "send")
      .mockRejectedValue(refusal("InvalidBucketName", 400));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await ensureBucket({ tries: 5, waitMs: 1 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("Could not make the bucket ushabti: InvalidBucketName");
  });

  it("says nothing to a 403, which a key scoped to its bucket answers", async () => {
    const send = vi
      .spyOn(S3Client.prototype, "send")
      .mockRejectedValue(refusal("AccessDenied", 403));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await ensureBucket({ tries: 5, waitMs: 1 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each(["InvalidAccessKeyId", "SignatureDoesNotMatch"])(
    "logs a 403 that says the key is wrong: %s",
    async (name) => {
      vi.spyOn(S3Client.prototype, "send").mockRejectedValue(refusal(name, 403));
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      await ensureBucket({ tries: 5, waitMs: 1 });
      expect(warn).toHaveBeenCalledWith(`Could not make the bucket ushabti: ${name}`);
    },
  );

  it("names the region outside us-east-1, where S3 needs it", async () => {
    vi.stubEnv("S3_REGION", "eu-west-1");
    const send = vi.spyOn(S3Client.prototype, "send").mockResolvedValue({} as never);
    await ensureBucket();
    expect((send.mock.calls[0][0] as CreateBucketCommand).input).toEqual({
      Bucket: "ushabti",
      CreateBucketConfiguration: { LocationConstraint: "eu-west-1" },
    });
  });
});
