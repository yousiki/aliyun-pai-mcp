import { Config } from "@alicloud/openapi-client";
import STSClient from "@alicloud/sts20150401";

export interface AliyunCredentials {
  accessKeyId: string;
  accessKeySecret: string;
  securityToken?: string;
}

export interface CallerIdentity {
  accountId: string;
  userId: string;
  identityType: string;
  arn: string;
}

export function createSTSClient(credentials: AliyunCredentials, regionId: string): STSClient {
  const config = new Config({
    endpoint: "sts.aliyuncs.com",
    accessKeyId: credentials.accessKeyId,
    accessKeySecret: credentials.accessKeySecret,
    securityToken: credentials.securityToken,
    regionId,
  });

  return new STSClient(config);
}

export async function getCallerIdentity(client: STSClient): Promise<CallerIdentity> {
  const response = await client.getCallerIdentity();
  const body = response.body;

  const accountId = body?.accountId;
  const userId = body?.userId;
  const identityType = body?.identityType;
  const arn = body?.arn;

  if (!accountId || !userId || !identityType || !arn) {
    throw new Error("Failed to resolve caller identity from STS response.");
  }

  return {
    accountId,
    userId,
    identityType,
    arn,
  };
}
