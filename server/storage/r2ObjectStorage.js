import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl as defaultSignUrl } from "@aws-sdk/s3-request-presigner";

const SIGNED_URL_TTL_SECONDS = 15 * 60;

export class R2ObjectStorageNotConfiguredError extends Error {
  statusCode = 503;
}

export const isR2NotFoundError = (error) =>
  error?.name === "NotFound" ||
  error?.name === "NoSuchKey" ||
  error?.$metadata?.httpStatusCode === 404;

const requireNonEmptyString = (value, label) => {
  if (typeof value !== "string" || !value.trim()) {
    throw new R2ObjectStorageNotConfiguredError(`${label} is required.`);
  }
  return value.trim();
};

export const getR2StorageConfig = ({ env = process.env, bucket } = {}) => {
  const accountId = env.R2_ACCOUNT_ID?.trim();
  const accessKeyId = env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY?.trim();
  const configuredBucket = (bucket || env.R2_BUCKET)?.trim();

  if (!accountId || !accessKeyId || !secretAccessKey || !configuredBucket) {
    throw new R2ObjectStorageNotConfiguredError(
      "R2 object storage is not configured.",
    );
  }

  return {
    bucket: configuredBucket,
    endpoint:
      env.R2_ENDPOINT?.trim() ||
      `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  };
};

// x-amz-copy-source expects the complete source path in one URL-encoded value.
export const buildR2CopySource = (bucket, key) =>
  `/${requireNonEmptyString(bucket, "Bucket")}/${encodeURIComponent(
    requireNonEmptyString(key, "Storage key"),
  )}`;

const contentDisposition = (fileName, disposition) => {
  const safeFileName = String(fileName || "download")
    .replace(/[\u0000-\u001f]/g, "_")
    .replace(/[^a-zA-Z0-9._ -]/g, "_");
  const encodedName = encodeURIComponent(String(fileName || "download"));
  return `${disposition}; filename="${safeFileName}"; filename*=UTF-8''${encodedName}`;
};

export const createR2ObjectStorage = ({
  bucket,
  env = process.env,
  s3Client,
  signUrl = defaultSignUrl,
} = {}) => {
  const config = getR2StorageConfig({ env, bucket });
  const client =
    s3Client ||
    new S3Client({
      region: "auto",
      endpoint: config.endpoint,
      forcePathStyle: true,
      credentials: config.credentials,
    });

  const createSignedUpload = async ({ key, contentType, sizeBytes }) => {
    const uploadUrl = await signUrl(
      client,
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: requireNonEmptyString(key, "Storage key"),
        ContentType: requireNonEmptyString(contentType, "Content type"),
        ContentLength: sizeBytes,
      }),
      { expiresIn: SIGNED_URL_TTL_SECONDS },
    );
    return {
      uploadUrl,
      expiresAt: new Date(
        Date.now() + SIGNED_URL_TTL_SECONDS * 1000,
      ).toISOString(),
    };
  };

  const createSignedRead = async ({
    key,
    contentType,
    fileName,
    disposition = "inline",
  }) => {
    const responseDisposition = disposition === "attachment" ? "attachment" : "inline";
    const url = await signUrl(
      client,
      new GetObjectCommand({
        Bucket: config.bucket,
        Key: requireNonEmptyString(key, "Storage key"),
        ...(contentType ? { ResponseContentType: contentType } : {}),
        ...(fileName
          ? {
              ResponseContentDisposition: contentDisposition(
                fileName,
                responseDisposition,
              ),
            }
          : {}),
      }),
      { expiresIn: SIGNED_URL_TTL_SECONDS },
    );
    return {
      url,
      expiresAt: new Date(
        Date.now() + SIGNED_URL_TTL_SECONDS * 1000,
      ).toISOString(),
    };
  };

  const head = ({ key }) =>
    client.send(
      new HeadObjectCommand({
        Bucket: config.bucket,
        Key: requireNonEmptyString(key, "Storage key"),
      }),
    );

  const put = ({
    key,
    body,
    contentType,
    sizeBytes,
    contentDisposition: disposition,
    metadata,
  }) =>
    client.send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: requireNonEmptyString(key, "Storage key"),
        Body: body,
        ContentType: contentType,
        ...(sizeBytes == null ? {} : { ContentLength: sizeBytes }),
        ...(disposition ? { ContentDisposition: disposition } : {}),
        ...(metadata ? { Metadata: metadata } : {}),
      }),
    );

  const copy = ({ sourceKey, targetKey, contentType, metadata }) =>
    client.send(
      new CopyObjectCommand({
        Bucket: config.bucket,
        CopySource: buildR2CopySource(config.bucket, sourceKey),
        Key: requireNonEmptyString(targetKey, "Target storage key"),
        ...(contentType ? { ContentType: contentType } : {}),
        ...(metadata ? { Metadata: metadata } : {}),
        ...(contentType || metadata ? { MetadataDirective: "REPLACE" } : {}),
      }),
    );

  const remove = ({ key }) =>
    client.send(
      new DeleteObjectCommand({
        Bucket: config.bucket,
        Key: requireNonEmptyString(key, "Storage key"),
      }),
    );

  return {
    bucket: config.bucket,
    client,
    createSignedUpload,
    createSignedRead,
    head,
    put,
    copy,
    delete: remove,
  };
};
