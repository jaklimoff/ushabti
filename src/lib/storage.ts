import "server-only";
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  attachmentConfig,
  getInput,
  putInput,
  READ_TTL_SECONDS,
  UPLOAD_TTL_SECONDS,
  type AttachmentConfig,
} from "./attachments";

/**
 * The only module that speaks S3. It signs URLs and asks about objects; it
 * never carries a file's bytes, apart from the first few of an image, which
 * hold its width and height.
 */

type On = Extract<AttachmentConfig, { on: true }>;

let cached: { config: On; client: S3Client } | null = null;

function client(config: On): S3Client {
  if (cached && sameBucket(cached.config, config)) return cached.client;
  const made = new S3Client({
    endpoint: config.endpoint ?? undefined,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: { accessKeyId: config.accessKey, secretAccessKey: config.secretKey },
    /* The SDK otherwise signs a checksum into every PUT, which a browser
       cannot send and MinIO or Spaces may not check the same way. */
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  cached = { config, client: made };
  return made;
}

function sameBucket(a: On, b: On): boolean {
  return (
    a.endpoint === b.endpoint &&
    a.region === b.region &&
    a.bucket === b.bucket &&
    a.accessKey === b.accessKey &&
    a.secretKey === b.secretKey &&
    a.forcePathStyle === b.forcePathStyle
  );
}

function on(): On {
  const config = attachmentConfig();
  if (!config.on) throw new Error("Attachments are off.");
  return config;
}

/* What a store answers when the bucket is there. "Exists" can mean somebody
   else's, but then every PUT fails anyway, and says so better. */
const BUCKET_THERE = new Set(["BucketAlreadyOwnedByYou", "BucketAlreadyExists"]);

/**
 * Makes the bucket, once, as the server starts. A local store starts empty,
 * and a helper container that made the bucket was one more image to pull. A
 * store that does not answer yet, or answers 5xx while it starts, is asked
 * again for about a minute: in Docker it may start after the app. AccessDenied
 * is quiet, because a production key is often scoped to a bucket somebody else
 * made. Any other refusal is logged, a wrong key among them, and the routes still say what is wrong
 * when somebody uploads.
 */
export async function ensureBucket({
  tries = 30,
  waitMs = 2000,
}: { tries?: number; waitMs?: number } = {}): Promise<void> {
  const config = on();
  const input = {
    Bucket: config.bucket,
    // us-east-1 is the one region S3 refuses to be named in.
    ...(config.region === "us-east-1"
      ? {}
      : { CreateBucketConfiguration: { LocationConstraint: config.region as never } }),
  };
  for (let attempt = 1; ; attempt++) {
    try {
      await client(config).send(new CreateBucketCommand(input));
      return;
    } catch (err) {
      const name = (err as { name?: string }).name ?? "";
      if (BUCKET_THERE.has(name)) return;
      // Only AccessDenied: a wrong key answers 403 too, and must be said.
      if (name === "AccessDenied") return;
      const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      const final = status !== undefined && status < 500;
      if (final || attempt >= tries) {
        console.warn(`Could not make the bucket ${config.bucket}: ${(err as Error).message}`);
        return;
      }
      await new Promise((done) => setTimeout(done, waitMs));
    }
  }
}

/** A PUT good for ten minutes, bound to the object, its mime and its length. */
export async function presignPut(row: { key: string; mime: string; size: number }) {
  const config = on();
  return getSignedUrl(client(config), new PutObjectCommand(putInput(config.bucket, row)), {
    expiresIn: UPLOAD_TTL_SECONDS,
    signableHeaders: new Set(["content-type", "content-length"]),
  });
}

/** A GET good for five minutes, inline or a download by the mime. */
export async function presignGet(row: { key: string; mime: string; name: string }) {
  const config = on();
  return getSignedUrl(client(config), new GetObjectCommand(getInput(config.bucket, row)), {
    expiresIn: READ_TTL_SECONDS,
  });
}

/** What the bucket holds under a key, or null when it holds nothing. */
export async function headObject(key: string): Promise<{ size: number; mime: string } | null> {
  const config = on();
  try {
    const head = await client(config).send(
      new HeadObjectCommand({ Bucket: config.bucket, Key: key }),
    );
    return { size: head.ContentLength ?? 0, mime: (head.ContentType ?? "").toLowerCase() };
  } catch (err) {
    const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404 || (err as { name?: string }).name === "NotFound") return null;
    throw err;
  }
}

/** The first bytes of an object, for the size of an image. */
export async function readHead(key: string, bytes: number): Promise<Uint8Array> {
  const config = on();
  const answer = await client(config).send(
    new GetObjectCommand({ Bucket: config.bucket, Key: key, Range: `bytes=0-${bytes - 1}` }),
  );
  return answer.Body ? await answer.Body.transformToByteArray() : new Uint8Array();
}

/** Removes an object. A key that holds nothing is removed already. */
export async function removeObject(key: string): Promise<void> {
  const config = on();
  await client(config).send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
}
