import {mkdtemp, rm} from "node:fs/promises";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {build} from "esbuild";

async function main() {
  const directory = await mkdtemp(path.join(
    process.cwd(), ".dayta-group-history-polish-qa-"));
  const output = path.join(directory, "group-history-polish-qa.mjs");
  try {
    await build({
      absWorkingDir: process.cwd(),
      entryPoints: [path.join(process.cwd(), "scripts",
        "group-history-polish-qa.ts")],
      outfile: output,
      bundle: true,
      packages: "external",
      format: "esm",
      platform: "node",
      target: "node22",
      plugins: [{
        name: "mock-group-history-react-native",
        setup(buildApi) {
          buildApi.onResolve({filter: /^react-native$/}, () => ({
            path: "react-native", namespace: "ui-mock",
          }));
          buildApi.onResolve({filter: /^@expo\/vector-icons$/}, () => ({
            path: "expo-icons", namespace: "ui-mock",
          }));
          buildApi.onLoad({filter: /.*/, namespace: "ui-mock"}, (args) => ({
            contents: args.path === "react-native" ?
              `export const Text = () => null;
               export const View = () => null;
               export const Pressable = () => null;
               export const StyleSheet = {create: (value) => value};` :
              "export const Ionicons = () => null;",
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
