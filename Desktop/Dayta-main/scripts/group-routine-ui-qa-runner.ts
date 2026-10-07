import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

async function main() {
  const temporaryDirectory = await mkdtemp(
    path.join(process.cwd(), ".dayta-group-routine-ui-qa-")
  );
  const bundlePath = path.join(temporaryDirectory, "group-routine-ui-qa.mjs");
  try {
    await build({
      absWorkingDir: process.cwd(),
      entryPoints: ["./scripts/group-routine-ui-qa.ts"],
      outfile: bundlePath,
      bundle: true,
      packages: "external",
      format: "esm",
      platform: "node",
      target: "node22",
      plugins: [{
        name: "mock-dayta-firebase",
        setup(buildApi) {
          buildApi.onResolve(
            { filter: /^\.\/firebase$/ },
            () => ({ path: "dayta-firebase", namespace: "qa-mock" })
          );
          buildApi.onLoad(
            { filter: /.*/, namespace: "qa-mock" },
            () => ({ contents: "export const db = {};" })
          );
        },
      }],
    });
    await import(pathToFileURL(bundlePath).href);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
