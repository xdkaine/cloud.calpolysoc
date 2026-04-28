import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  ListBucketsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  CreateTableCommand,
  DeleteTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  ListTablesCommand,
} from "@aws-sdk/client-dynamodb";
import { DeleteCommand, DynamoDBDocumentClient, PutCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import {
  CreateQueueCommand,
  DeleteMessageCommand,
  DeleteQueueCommand,
  GetQueueAttributesCommand,
  ListQueuesCommand,
  PurgeQueueCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";

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
const ddbDoc = DynamoDBDocumentClient.from(ddb, {
  marshallOptions: {
    removeUndefinedValues: true,
  },
});

type DynamoKeyAttribute = {
  name: string;
  type: "S" | "N" | "B";
};

type QueueMessageSummary = {
  messageId: string;
  receiptHandle: string;
  body: string;
  attributes: Record<string, string>;
};

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

export async function createBucket(bucket: string) {
  await s3.send(new CreateBucketCommand({ Bucket: bucket }));
}

export async function deleteBucket(bucket: string) {
  await s3.send(new DeleteBucketCommand({ Bucket: bucket }));
}

export async function putObject(
  bucket: string,
  key: string,
  body: Uint8Array,
  contentType?: string,
) {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

export async function deleteObject(bucket: string, key: string) {
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

export async function listTables() {
  const r = await ddb.send(new ListTablesCommand({}));
  const names = r.TableNames ?? [];
  const details = await Promise.all(
    names.map(async (name) => {
      try {
        const d = await ddb.send(new DescribeTableCommand({ TableName: name }));
        const table = d.Table;
        const attributeDefinitions = new Map(
          (table?.AttributeDefinitions ?? []).map((attribute) => [
            attribute.AttributeName ?? "",
            attribute.AttributeType ?? "S",
          ]),
        );
        const partitionKey = table?.KeySchema?.find(
          (entry) => entry.KeyType === "HASH",
        )?.AttributeName;
        const sortKey = table?.KeySchema?.find(
          (entry) => entry.KeyType === "RANGE",
        )?.AttributeName;
        return {
          name,
          status: table?.TableStatus ?? "UNKNOWN",
          itemCount: table?.ItemCount ?? 0,
          sizeBytes: table?.TableSizeBytes ?? 0,
          partitionKey,
          partitionKeyType: partitionKey
            ? attributeDefinitions.get(partitionKey) ?? "S"
            : undefined,
          sortKey,
          sortKeyType: sortKey ? attributeDefinitions.get(sortKey) ?? "S" : undefined,
        };
      } catch {
        return {
          name,
          status: "UNKNOWN",
          itemCount: 0,
          sizeBytes: 0,
          partitionKey: undefined,
          partitionKeyType: undefined,
          sortKey: undefined,
          sortKeyType: undefined,
        };
      }
    }),
  );
  return details;
}

export async function createTable(input: {
  tableName: string;
  partitionKey: DynamoKeyAttribute;
  sortKey?: DynamoKeyAttribute;
}) {
  const attributeDefinitions: Array<{
    AttributeName: string;
    AttributeType: "S" | "N" | "B";
  }> = [
    {
      AttributeName: input.partitionKey.name,
      AttributeType: input.partitionKey.type,
    },
  ];
  const keySchema: Array<{
    AttributeName: string;
    KeyType: "HASH" | "RANGE";
  }> = [
    {
      AttributeName: input.partitionKey.name,
      KeyType: "HASH" as const,
    },
  ];

  if (input.sortKey) {
    attributeDefinitions.push({
      AttributeName: input.sortKey.name,
      AttributeType: input.sortKey.type,
    });
    keySchema.push({
      AttributeName: input.sortKey.name,
      KeyType: "RANGE" as const,
    });
  }

  await ddb.send(
    new CreateTableCommand({
      TableName: input.tableName,
      AttributeDefinitions: attributeDefinitions,
      KeySchema: keySchema,
      BillingMode: "PAY_PER_REQUEST",
    }),
  );
}

export async function deleteTable(tableName: string) {
  await ddb.send(new DeleteTableCommand({ TableName: tableName }));
}

export async function listTableItems(tableName: string, limit = 25) {
  const result = await ddbDoc.send(
    new ScanCommand({
      TableName: tableName,
      Limit: Math.max(1, Math.min(limit, 100)),
    }),
  );
  return (result.Items ?? []) as Array<Record<string, unknown>>;
}

export async function putTableItem(tableName: string, item: Record<string, unknown>) {
  await ddbDoc.send(
    new PutCommand({
      TableName: tableName,
      Item: item,
    }),
  );
}

export async function deleteTableItem(
  tableName: string,
  key: Record<string, unknown>,
) {
  await ddbDoc.send(
    new DeleteCommand({
      TableName: tableName,
      Key: key,
    }),
  );
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
          delayed: Number(a.Attributes?.ApproximateNumberOfMessagesDelayed ?? 0),
        };
      } catch {
        return { name, url, messages: 0, inFlight: 0, delayed: 0 };
      }
    }),
  );
  return details;
}

export async function createQueue(queueName: string) {
  const result = await sqs.send(new CreateQueueCommand({ QueueName: queueName }));
  return result.QueueUrl ?? "";
}

export async function deleteQueue(queueUrl: string) {
  await sqs.send(new DeleteQueueCommand({ QueueUrl: queueUrl }));
}

export async function sendQueueMessage(queueUrl: string, body: string) {
  const result = await sqs.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: body,
    }),
  );
  return result.MessageId ?? "";
}

export async function receiveQueueMessages(queueUrl: string, maxMessages = 10) {
  const result = await sqs.send(
    new ReceiveMessageCommand({
      QueueUrl: queueUrl,
      MaxNumberOfMessages: Math.max(1, Math.min(maxMessages, 10)),
      VisibilityTimeout: 30,
      WaitTimeSeconds: 1,
      AttributeNames: ["All"],
    }),
  );

  return (result.Messages ?? []).map(
    (message): QueueMessageSummary => ({
      messageId: message.MessageId ?? "unknown",
      receiptHandle: message.ReceiptHandle ?? "",
      body: message.Body ?? "",
      attributes: message.Attributes ?? {},
    }),
  );
}

export async function deleteQueueMessage(queueUrl: string, receiptHandle: string) {
  await sqs.send(
    new DeleteMessageCommand({
      QueueUrl: queueUrl,
      ReceiptHandle: receiptHandle,
    }),
  );
}

export async function purgeQueue(queueUrl: string) {
  await sqs.send(new PurgeQueueCommand({ QueueUrl: queueUrl }));
}
