import { S3Client, ListBucketsCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { DynamoDBClient, ListTablesCommand, DescribeTableCommand } from "@aws-sdk/client-dynamodb";
import { SQSClient, ListQueuesCommand, GetQueueAttributesCommand } from "@aws-sdk/client-sqs";

const endpoint =
  process.env.FLOCI_ENDPOINT_URL?.replace(/\/$/, "") ??
  process.env.CLOUD_API_BASE_URL?.replace(/\/$/, "") ??
  "http://api.cloud.calpolysoc.org";

const region = process.env.AWS_DEFAULT_REGION ?? "us-east-1";
const credentials = {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "test",
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "test",
};

export const s3 = new S3Client({
  endpoint,
  region,
  credentials,
  forcePathStyle: true,
});

export const ddb = new DynamoDBClient({ endpoint, region, credentials });
export const sqs = new SQSClient({ endpoint, region, credentials });

export async function listBuckets() {
  const r = await s3.send(new ListBucketsCommand({}));
  return (r.Buckets ?? []).map((b) => ({
    name: b.Name!,
    creationDate: b.CreationDate?.toISOString(),
  }));
}

export async function listObjects(bucket: string) {
  const r = await s3.send(new ListObjectsV2Command({ Bucket: bucket }));
  return (r.Contents ?? []).map((o) => ({
    key: o.Key!,
    size: o.Size ?? 0,
    lastModified: o.LastModified?.toISOString(),
  }));
}

export async function listTables() {
  const r = await ddb.send(new ListTablesCommand({}));
  const names = r.TableNames ?? [];
  const details = await Promise.all(
    names.map(async (name) => {
      try {
        const d = await ddb.send(new DescribeTableCommand({ TableName: name }));
        return {
          name,
          status: d.Table?.TableStatus ?? "UNKNOWN",
          itemCount: d.Table?.ItemCount ?? 0,
          sizeBytes: d.Table?.TableSizeBytes ?? 0,
        };
      } catch {
        return { name, status: "UNKNOWN", itemCount: 0, sizeBytes: 0 };
      }
    }),
  );
  return details;
}

export async function listQueues() {
  const r = await sqs.send(new ListQueuesCommand({}));
  const urls = r.QueueUrls ?? [];
  const details = await Promise.all(
    urls.map(async (url) => {
      const name = url.split("/").pop() ?? url;
      try {
        const a = await sqs.send(
          new GetQueueAttributesCommand({
            QueueUrl: url,
            AttributeNames: ["All"],
          }),
        );
        return {
          name,
          url,
          messages: Number(a.Attributes?.ApproximateNumberOfMessages ?? 0),
          inFlight: Number(
            a.Attributes?.ApproximateNumberOfMessagesNotVisible ?? 0,
          ),
        };
      } catch {
        return { name, url, messages: 0, inFlight: 0 };
      }
    }),
  );
  return details;
}
