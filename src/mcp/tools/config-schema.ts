import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { ConfigStore } from "../../config/store.js";
import { sanitizeObject } from "../../utils/sanitize.js";

interface FieldDescriptor {
  path: string;
  type: string;
  description: string;
  constraints: Record<string, unknown>;
  currentValue: unknown;
  modifiable: boolean;
}

interface FieldGroup {
  name: string;
  description: string;
  fields: FieldDescriptor[];
}

function toText(payload: unknown): string {
  return JSON.stringify(payload, null, 2);
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const segments = path.replace(/\[(\d+)\]/g, ".$1").split(".");
  let current: unknown = obj;
  for (const segment of segments) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function buildSchema(settings: Record<string, unknown>): FieldGroup[] {
  const groups: FieldGroup[] = [];

  // --- Job Resources ---
  groups.push({
    name: "Job Resources",
    description: "GPU, CPU, memory, and shared memory allocated to each worker pod.",
    fields: [
      {
        path: "jobSpecs[0].resourceConfig.GPU",
        type: "string",
        description:
          "Number of GPUs per worker pod (string, e.g. '1', '4', '8'). " +
          "Must match available GPU counts on the selected resource quota.",
        constraints: { examples: ["1", "2", "4", "8"] },
        currentValue: getNestedValue(settings, "jobSpecs.0.resourceConfig.GPU"),
        modifiable: true,
      },
      {
        path: "jobSpecs[0].resourceConfig.CPU",
        type: "string",
        description:
          "Number of CPU cores per worker pod (string, e.g. '8', '16'). " +
          "Must be compatible with the selected GPU configuration.",
        constraints: { examples: ["4", "8", "12", "16", "32"] },
        currentValue: getNestedValue(settings, "jobSpecs.0.resourceConfig.CPU"),
        modifiable: true,
      },
      {
        path: "jobSpecs[0].resourceConfig.memory",
        type: "string",
        description:
          "Main memory per worker pod (string with unit, e.g. '32Gi', '64Gi'). " +
          "Kubernetes format: Gi = gibibytes.",
        constraints: { format: "<number>Gi", examples: ["16Gi", "32Gi", "64Gi", "128Gi"] },
        currentValue: getNestedValue(settings, "jobSpecs.0.resourceConfig.memory"),
        modifiable: true,
      },
      {
        path: "jobSpecs[0].resourceConfig.sharedMemory",
        type: "string",
        description:
          "Shared memory (/dev/shm) per worker pod (string with unit, e.g. '32Gi'). " +
          "Important for PyTorch DataLoader with num_workers > 0.",
        constraints: { format: "<number>Gi", examples: ["16Gi", "32Gi", "64Gi"] },
        currentValue: getNestedValue(settings, "jobSpecs.0.resourceConfig.sharedMemory"),
        modifiable: true,
      },
    ],
  });

  // --- Docker Image ---
  groups.push({
    name: "Docker Image",
    description: "Container image used for job workers.",
    fields: [
      {
        path: "jobSpecs[0].image",
        type: "string",
        description:
          "Full docker image URI (e.g. 'registry.cn-hangzhou.aliyuncs.com/org/image:tag'). " +
          "Must be accessible from the PAI-DLC cluster.",
        constraints: { format: "registry/repository:tag" },
        currentValue: getNestedValue(settings, "jobSpecs.0.image"),
        modifiable: true,
      },
    ],
  });

  // --- Job Type ---
  groups.push({
    name: "Job Type",
    description: "DLC distributed training framework type.",
    fields: [
      {
        path: "jobType",
        type: "string",
        description:
          "Distributed training framework. Determines how workers communicate " +
          "and how the job is orchestrated by PAI-DLC.",
        constraints: { enum: ["PyTorchJob", "TFJob", "MPIJob", "XGBoostJob", "RayJob"] },
        currentValue: getNestedValue(settings, "jobType"),
        modifiable: true,
      },
    ],
  });

  // --- Pod Count ---
  groups.push({
    name: "Pod Count",
    description: "Number of worker pods for distributed training.",
    fields: [
      {
        path: "jobSpecs[0].podCount",
        type: "number",
        description:
          "Number of worker pods to launch. For single-GPU jobs use 1. " +
          "For distributed training, set to the number of nodes.",
        constraints: { min: 1 },
        currentValue: getNestedValue(settings, "jobSpecs.0.podCount"),
        modifiable: true,
      },
    ],
  });

  // --- Mounts ---
  const mounts = (settings.mounts as unknown[]) ?? [];
  groups.push({
    name: "Mounts",
    description:
      "Data source mounts (OSS buckets, NAS, etc.) attached to job containers. " +
      "Update by providing the full mounts array.",
    fields: [
      {
        path: "mounts",
        type: "array",
        description:
          "Array of data source mounts. Each mount has: name (string), uri (string, e.g. 'oss://bucket/path/'), " +
          "mountPath (string, e.g. '/mnt/data'), mountAccess ('ReadOnly' | 'ReadWrite'), " +
          "options (string, optional), description (string, optional).",
        constraints: {
          itemSchema: {
            name: "string (required)",
            uri: "string (required)",
            mountPath: "string (required)",
            mountAccess: { enum: ["ReadOnly", "ReadWrite"] },
            options: "string (optional)",
            description: "string (optional)",
          },
        },
        currentValue: mounts,
        modifiable: true,
      },
    ],
  });

  // --- Concurrency ---
  groups.push({
    name: "Concurrency",
    description: "Controls how many jobs can run simultaneously under this project prefix.",
    fields: [
      {
        path: "maxRunningJobs",
        type: "number",
        description:
          "Maximum number of active (non-terminal) jobs allowed concurrently. " +
          "New submissions are rejected when this limit is reached. Default: 1.",
        constraints: { min: 1, default: 1 },
        currentValue: getNestedValue(settings, "maxRunningJobs") ?? 1,
        modifiable: true,
      },
    ],
  });

  // --- Profiles ---
  const profiles = (settings.profiles as Record<string, unknown>) ?? {};
  groups.push({
    name: "Profiles",
    description:
      "Named configuration presets. Use pai_config_apply_profile to apply a profile, " +
      "or pai_config_create_profile to create new ones.",
    fields: [
      {
        path: "profiles",
        type: "object",
        description:
          "Map of profile names to partial settings overrides. " +
          "Each profile can override: jobSpecs, jobType, mounts, maxRunningJobs.",
        constraints: {
          keyPattern: "lowercase alphanumeric and hyphens",
          reservedNames: ["default", "current"],
        },
        currentValue: Object.keys(profiles),
        modifiable: true,
      },
    ],
  });

  return groups;
}

export function registerConfigSchemaTool(server: McpServer, configStore: ConfigStore): void {
  server.registerTool(
    "pai_config_schema",
    {
      description:
        "Inspect all modifiable configuration fields with descriptions, types, constraints, " +
        "and current values. Returns structured field groups: Job Resources (GPU/CPU/memory), " +
        "Docker Image, Job Type, Pod Count, Mounts, Concurrency, and Profiles. " +
        "Use this to understand what can be changed via pai_config_update.",
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async (_extra) => {
      const settings = configStore.get();
      const schema = buildSchema(settings as unknown as Record<string, unknown>);
      const result = sanitizeObject(schema);
      return {
        content: [{ type: "text", text: toText(result) }],
      };
    },
  );
}
