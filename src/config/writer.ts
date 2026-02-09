import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { getSettingsPath } from "./loader.js";
import type { Settings } from "./schema.js";
import { SettingsSchema } from "./schema.js";

export async function writeSettings(settings: Settings, filePath?: string): Promise<void> {
  const targetPath = filePath ?? getSettingsPath();
  const validatedSettings = SettingsSchema.parse(settings);

  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, `${JSON.stringify(validatedSettings, null, 2)}\n`, "utf8");
  await chmod(targetPath, 0o600);
}
