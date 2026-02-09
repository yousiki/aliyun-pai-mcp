import { Config } from "@alicloud/openapi-client";
import type {
  CreateJobRequest,
  GetJobRequest,
  GetPodLogsRequest,
  ListJobsRequest,
} from "@alicloud/pai-dlc20201203";
import DLCClient from "@alicloud/pai-dlc20201203";

export interface AliyunCredentials {
  accessKeyId: string;
  accessKeySecret: string;
  securityToken?: string;
}

export interface DlcCreateJobRequest extends CreateJobRequest {}

export interface DlcListJobsRequest extends ListJobsRequest {}

export interface DlcGetJobRequest extends GetJobRequest {}

export interface DlcGetPodLogsRequest extends GetPodLogsRequest {}

export interface DlcClientApi {
  createJob(request: DlcCreateJobRequest): ReturnType<DLCClient["createJob"]>;
  listJobs(request: DlcListJobsRequest): ReturnType<DLCClient["listJobs"]>;
  getJob(jobId: string, request: DlcGetJobRequest): ReturnType<DLCClient["getJob"]>;
  stopJob(jobId: string): ReturnType<DLCClient["stopJob"]>;
  getPodLogs(
    jobId: string,
    podId: string,
    request: DlcGetPodLogsRequest,
  ): ReturnType<DLCClient["getPodLogs"]>;
}

export function createDLCClient(credentials: AliyunCredentials, regionId: string): DLCClient {
  const config = new Config({
    endpoint: `pai-dlc.${regionId}.aliyuncs.com`,
    accessKeyId: credentials.accessKeyId,
    accessKeySecret: credentials.accessKeySecret,
    securityToken: credentials.securityToken,
    regionId,
  });

  return new DLCClient(config);
}
