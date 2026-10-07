import {mkdtemp, rm} from "node:fs/promises";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {build} from "esbuild";

async function main() {
  const directory = await mkdtemp(path.join(
    process.cwd(), ".dayta-group-history-query-qa-"));
  const output = path.join(directory, "group-history-query-qa.mjs");
  try {
  await build({
    absWorkingDir: process.cwd(),
    entryPoints: [path.join(process.cwd(), "scripts",
      "group-history-query-emulator-qa.ts").replaceAll("\\", "/")],
    outfile: output,
    bundle: true,
    packages: "external",
    format: "esm",
    platform: "node",
    target: "node22",
    plugins: [{
      name: "group-history-emulator-firebase",
      setup(buildApi) {
        buildApi.onResolve({filter: /^\.{1,2}[\\/].*firebase$/}, () => ({
          path: "dayta-group-query-firebase",
          namespace: "qa-firebase",
        }));
        buildApi.onLoad({filter: /.*/, namespace: "qa-firebase"}, () => ({
          resolveDir: process.cwd(),
          contents: `
            import {readFileSync} from "node:fs";
            import {initializeTestEnvironment} from
              "@firebase/rules-unit-testing";
            const [host, portText] =
              process.env.FIRESTORE_EMULATOR_HOST.split(":");
            export const qaTestEnv = await initializeTestEnvironment({
              projectId: "dayta---goalsettingapp",
              firestore: {
                host,
                port: Number(portText),
                rules: readFileSync("firestore.rules", "utf8")
              }
            });
            export const db =
              qaTestEnv.authenticatedContext("owner").firestore();
          `,
        }));
      },
    }],
  });
    await import(pathToFileURL(output).href);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
