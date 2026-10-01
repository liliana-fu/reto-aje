import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { tracer } from './logger';

const s3 = tracer.captureAWSv3Client(new S3Client({}));

export async function putJson(bucket: string, key: string, body: unknown): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: JSON.stringify(body),
      ContentType: 'application/json; charset=utf-8',
    }),
  );
}

export async function getJson(bucket: string, key: string): Promise<unknown> {
  const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const text = await res.Body?.transformToString('utf-8');
  if (text === undefined) throw new Error(`Objeto vacío s3://${bucket}/${key}`);
  return JSON.parse(text) as unknown;
}

export async function listKeys(bucket: string, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const res = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
    for (const obj of res.Contents ?? []) if (obj.Key) keys.push(obj.Key);
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return keys;
}
