import { rm } from "node:fs/promises";
await rm(new URL("../packages/shadcnui-dashboard/dist", import.meta.url), {
    recursive: true,
    force: true,
});
