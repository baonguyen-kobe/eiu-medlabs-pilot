import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { basename, resolve } from "node:path";

const sourceSupabaseDir = resolve("supabase");
const targetArgument = process.argv[2];

if (!targetArgument) {
  throw new Error(
    "Usage: node scripts/prepare-ci-supabase-workdir.mjs <target>",
  );
}

const targetWorkdir = resolve(targetArgument);
if (targetWorkdir === sourceSupabaseDir) {
  throw new Error(
    "The CI Supabase workdir must not be the canonical supabase tree.",
  );
}
if (!existsSync(`${sourceSupabaseDir}/config.toml`)) {
  throw new Error("The committed supabase/config.toml is required.");
}

if (existsSync(targetWorkdir)) {
  if (readdirSync(targetWorkdir).length > 0) {
    throw new Error("The CI Supabase workdir must be empty.");
  }
} else {
  mkdirSync(targetWorkdir, { recursive: true });
}

cpSync(sourceSupabaseDir, `${targetWorkdir}/supabase`, {
  recursive: true,
  force: false,
  filter: (sourcePath) => basename(sourcePath) !== ".temp",
});

const configPath = `${targetWorkdir}/supabase/config.toml`;
let config = readFileSync(configPath, "utf8");
const runtimeReplacements = [
  ['project_id = "eiu-medlabs-pilot"', 'project_id = "lich-truc-app-ci"'],
  ["port = 58321", "port = 55421"],
  ["port = 58322", "port = 55422"],
  ["shadow_port = 58320", "shadow_port = 55420"],
  ["port = 58329", "port = 55429"],
  ["port = 58323", "port = 55423"],
  ["port = 58324", "port = 55424"],
  ["inspector_port = 8183", "inspector_port = 55883"],
  ["port = 58327", "port = 55427"],
  ["sign_in_sign_ups = 30", "sign_in_sign_ups = 1000"],
];

for (const [from, to] of runtimeReplacements) {
  const occurrences = config.split(from).length - 1;
  if (occurrences !== 1) {
    throw new Error(`Expected exactly one runtime config entry: ${from}`);
  }
  config = config.replace(from, to);
}

writeFileSync(configPath, config, "utf8");
