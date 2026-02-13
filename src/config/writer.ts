import { randomUUID } from "node:crypto";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { getSettingsPath } from "./loader.js";
import type { Settings } from "./schema.js";
import { SettingsSchema } from "./schema.js";

export async function writeSettings(settings: Settings, filePath?: string): Promise<void> {
  const targetPath = filePath ?? getSettingsPath();
  const validatedSettings = SettingsSchema.parse(settings);
  const dir = path.dirname(targetPath);

  await mkdir(dir, { recursive: true });

  const tmpPath = path.join(dir, `.settings.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(tmpPath, `${JSON.stringify(validatedSettings, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(tmpPath, targetPath);
  } catch (error) {
    await unlink(tmpPath).catch(() => {});
    throw error;
  }
}
