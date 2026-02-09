import { z } from "zod";

export const CredentialsSchema = z.object({
  accessKeyId: z.string().min(1),
  accessKeySecret: z.string().min(1),
  securityToken: z.string().min(1).optional(),
});

export type Credentials = z.infer<typeof CredentialsSchema>;

export const CallerSchema = z.object({
  accountId: z.string().nullable().optional(),
  userId: z.string().nullable().optional(),
  identityType: z.string().nullable().optional(),
});

export type Caller = z.infer<typeof CallerSchema>;

export const CodeSourceSchema = z.object({
  codeSourceId: z.string().min(1),
  mountPath: z.string().min(1),
  defaultBranch: z.string().min(1),
  defaultCommit: z.string().nullable().optional(),
});

export type CodeSource = z.infer<typeof CodeSourceSchema>;

export const JobSimpleDefaultsSchema = z.object({
  dockerImage: z.string().min(1),
  ecsSpec: z.string().min(1),
  podCount: z.number().int().positive(),
});

export type JobSimpleDefaults = z.infer<typeof JobSimpleDefaultsSchema>;

export const JobSpecSchema = z.record(z.unknown());

export type JobSpec = z.infer<typeof JobSpecSchema>;

export const JobDefaultsSchema = z.object({
  jobType: z.string().min(1),
  displayNamePrefix: z.string().min(1),
  jobSpecs: z.array(JobSpecSchema),
  simple: JobSimpleDefaultsSchema.optional(),
  allowedNodes: z.array(z.string().min(1)).optional(),
});

export type JobDefaults = z.infer<typeof JobDefaultsSchema>;

export const MountAccessSchema = z.enum(["ReadOnly", "ReadWrite"]);

export type MountAccess = z.infer<typeof MountAccessSchema>;

export const MountSchema = z.object({
  name: z.string().min(1),
  uri: z.string().min(1),
  mountPath: z.string().min(1),
  mountAccess: MountAccessSchema,
  options: z.string().nullable().optional(),
  description: z.string().min(1).optional(),
});

export type Mount = z.infer<typeof MountSchema>;

export const SettingsSchema = z.object({
  version: z.string().min(1),
  projectPrefix: z.string().min(1),
  regionId: z.string().min(1),
  workspaceId: z.string().min(1),
  resourceId: z.string().min(1),
  credentials: CredentialsSchema,
  caller: CallerSchema.optional(),
  codeSource: CodeSourceSchema,
  jobDefaults: JobDefaultsSchema,
  mounts: z.array(MountSchema),
});

export type Settings = z.infer<typeof SettingsSchema>;
