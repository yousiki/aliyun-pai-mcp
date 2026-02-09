import WorkspaceClient from "@alicloud/aiworkspace20210204";
import { Config } from "@alicloud/openapi-client";

export interface AliyunCredentials {
  accessKeyId: string;
  accessKeySecret: string;
  securityToken?: string;
}

export function createWorkspaceClient(
  credentials: AliyunCredentials,
  regionId: string,
): WorkspaceClient {
  const config = new Config({
    endpoint: `aiworkspace.${regionId}.aliyuncs.com`,
    accessKeyId: credentials.accessKeyId,
    accessKeySecret: credentials.accessKeySecret,
    securityToken: credentials.securityToken,
    regionId,
  });

  return new WorkspaceClient(config);
}
