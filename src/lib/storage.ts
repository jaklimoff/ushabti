import "server-only";
import {
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
