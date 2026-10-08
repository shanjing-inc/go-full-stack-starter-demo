import { copyFile } from "node:fs/promises";
await copyFile(
    new URL("../packages/shadcnui-dashboard/src/styles.css", import.meta.url),
    new URL("../packages/shadcnui-dashboard/dist/styles.css", import.meta.url),
);
