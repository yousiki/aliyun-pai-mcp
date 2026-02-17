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

export const JobSpecSchema = z.record(z.string(), z.unknown());

export type JobSpec = z.infer<typeof JobSpecSchema>;

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

export const LimitsSchema = z
  .object({
    maxRunningJobs: z.number().int().positive().optional(),
    maxGPU: z.number().int().nonnegative().optional(),
    maxCPU: z.number().int().nonnegative().optional(),
  })
  .strict();

export type Limits = z.infer<typeof LimitsSchema>;

export const ProfileSchema = z
  .object({
    jobSpecs: z.array(JobSpecSchema),
    jobType: z.string().min(1),
  })
  .strict();

export type Profile = z.infer<typeof ProfileSchema>;

const ProfileNameSchema = z
  .string()
  .regex(/^[a-z0-9-]+$/)
  .refine((name) => name !== "current", "Profile name 'current' is reserved");

export const SettingsSchema = z.object({
  version: z.string().min(1),
  projectPrefix: z.string().min(1),
  regionId: z.string().min(1),
  workspaceId: z.string().min(1),
  resourceId: z.string().min(1),
  credentials: CredentialsSchema,
  caller: CallerSchema.optional(),
  codeSource: CodeSourceSchema.optional(),
  mounts: z.array(MountSchema),
  limits: LimitsSchema.optional(),
  profiles: z
    .record(ProfileNameSchema, ProfileSchema)
    .refine((profiles) => "default" in profiles, "A 'default' profile is required"),
});

export type Settings = z.infer<typeof SettingsSchema>;
