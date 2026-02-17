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

  // --- Profiles ---
  const profiles = (settings.profiles as Record<string, unknown>) ?? {};
  const profileFields: FieldDescriptor[] = [];

  for (const [profileName, profileValue] of Object.entries(profiles)) {
    const profile = (profileValue as Record<string, unknown>) ?? {};
    const firstSpec =
      ((profile.jobSpecs as unknown[])?.[0] as Record<string, unknown> | undefined) ?? {};
    const resourceConfig = (firstSpec.resourceConfig as Record<string, unknown>) ?? {};
    const image = firstSpec.image;
    const gpu = resourceConfig.GPU;
    const cpu = resourceConfig.CPU;
    const memory = resourceConfig.memory;
    const sharedMemory = resourceConfig.sharedMemory;
    const podCount = firstSpec.podCount;

    const summary =
      `image=${String(image ?? "n/a")}, ` +
      `GPU=${String(gpu ?? "n/a")}, ` +
      `CPU=${String(cpu ?? "n/a")}, ` +
      `memory=${String(memory ?? "n/a")}, ` +
      `sharedMemory=${String(sharedMemory ?? "n/a")}, ` +
      `podCount=${String(podCount ?? "n/a")}`;

    profileFields.push(
      {
        path: `profiles.${profileName}.jobType`,
        type: "string",
        description:
          `Training framework for profile "${profileName}". ` + `Current summary: ${summary}.`,
        constraints: { enum: ["PyTorchJob", "TFJob", "MPIJob", "XGBoostJob", "RayJob"] },
        currentValue: profile.jobType,
        modifiable: true,
      },
      {
        path: `profiles.${profileName}.jobSpecs[0].image`,
        type: "string",
        description: `Worker image for profile "${profileName}". Current summary: ${summary}.`,
        constraints: { format: "registry/repository:tag" },
        currentValue: image,
        modifiable: true,
      },
      {
        path: `profiles.${profileName}.jobSpecs[0].resourceConfig.GPU`,
        type: "string",
        description: `GPU count per worker for profile "${profileName}". Current summary: ${summary}.`,
        constraints: { examples: ["0", "1", "2", "4", "8"] },
        currentValue: gpu,
        modifiable: true,
      },
      {
        path: `profiles.${profileName}.jobSpecs[0].resourceConfig.CPU`,
        type: "string",
        description: `CPU cores per worker for profile "${profileName}". Current summary: ${summary}.`,
        constraints: { examples: ["4", "8", "16", "32"] },
        currentValue: cpu,
        modifiable: true,
      },
      {
        path: `profiles.${profileName}.jobSpecs[0].resourceConfig.memory`,
        type: "string",
        description: `Memory per worker for profile "${profileName}". Current summary: ${summary}.`,
        constraints: { format: "<number>Gi", examples: ["16Gi", "32Gi", "64Gi", "128Gi"] },
        currentValue: memory,
        modifiable: true,
      },
      {
        path: `profiles.${profileName}.jobSpecs[0].resourceConfig.sharedMemory`,
        type: "string",
        description:
          `Shared memory (tmpfs /dev/shm) per worker for profile "${profileName}". ` +
          "Required for PyTorch DataLoader with num_workers > 0. " +
          `Current summary: ${summary}.`,
        constraints: { format: "<number>Gi", examples: ["16Gi", "32Gi", "64Gi"] },
        currentValue: sharedMemory,
        modifiable: true,
      },
      {
        path: `profiles.${profileName}.jobSpecs[0].podCount`,
        type: "number",
        description: `Worker pod count for profile "${profileName}". Current summary: ${summary}.`,
        constraints: { min: 1 },
        currentValue: podCount,
        modifiable: true,
      },
    );
  }

  groups.push({
    name: "Profiles",
    description:
      "Named job configuration presets. Profiles are the primary source for jobType and jobSpecs. " +
      'A "default" profile is required.',
    fields: profileFields,
  });

  groups.push({
    name: "Limits",
    description:
      "Global submission limits shared by all profiles. " +
      "Use these fields to control concurrent jobs and resource caps.",
    fields: [
      {
        path: "limits.maxRunningJobs",
        type: "number",
        description: "Maximum number of active jobs allowed concurrently for this project prefix.",
        constraints: { min: 1 },
        currentValue: getNestedValue(settings, "limits.maxRunningJobs"),
        modifiable: true,
      },
      {
        path: "limits.maxGPU",
        type: "number",
        description: "Global upper bound for total requested GPUs across active jobs.",
        constraints: { min: 0 },
        currentValue: getNestedValue(settings, "limits.maxGPU"),
        modifiable: true,
      },
      {
        path: "limits.maxCPU",
        type: "number",
        description: "Global upper bound for total requested CPU cores across active jobs.",
        constraints: { min: 0 },
        currentValue: getNestedValue(settings, "limits.maxCPU"),
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

  const codeSource = settings.codeSource as Record<string, unknown> | undefined;
  if (codeSource) {
    groups.push({
      name: "Code Source",
      description:
        "Optional repository checkout configuration for submitted jobs. " +
        "Only shown when codeSource is configured.",
      fields: [
        {
          path: "codeSource.mountPath",
          type: "string",
          description: "Mount path where source code is checked out inside the container.",
          constraints: { examples: ["/root/code", "/workspace"] },
          currentValue: getNestedValue(settings, "codeSource.mountPath"),
          modifiable: true,
        },
        {
          path: "codeSource.defaultBranch",
          type: "string",
          description: "Default git branch used when submitting jobs without codeBranch override.",
          constraints: {},
          currentValue: getNestedValue(settings, "codeSource.defaultBranch"),
          modifiable: true,
        },
        {
          path: "codeSource.defaultCommit",
          type: "string | null",
          description: "Optional default git commit pin used for deterministic job submissions.",
          constraints: { nullable: true },
          currentValue: getNestedValue(settings, "codeSource.defaultCommit"),
          modifiable: true,
        },
      ],
    });
  }

  return groups;
}

export function registerConfigSchemaTool(server: McpServer, configStore: ConfigStore): void {
  server.registerTool(
    "pai_config_schema",
    {
      description:
        "Inspect all modifiable configuration fields with descriptions, types, constraints, " +
        "and current values. Returns structured field groups: Profiles, Limits, Mounts, " +
        "and Code Source (if configured). Use this to understand what can be changed via " +
        "pai_config_update.",
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
