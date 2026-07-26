import { readFileSync, writeFileSync } from "fs";

// Run by npm's "version" lifecycle script — see package.json. `npm version
// <patch|minor|major>` writes the new version into package.json and then
// invokes this to carry it over to the files Obsidian actually reads.
//
// Adapted from obsidianmd/obsidian-sample-plugin. The only deviation is
// formatting: upstream writes tab-indented JSON with no trailing newline,
// which would reformat this repo's files on every release.

const targetVersion = process.env.npm_package_version;

// read minAppVersion from manifest.json and bump version to target version
const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const { minAppVersion } = manifest;
manifest.version = targetVersion;
writeFileSync("manifest.json", JSON.stringify(manifest, null, 2) + "\n");

// update versions.json with target version and minAppVersion from manifest.json
// but only if the target version is not already in versions.json
const versions = JSON.parse(readFileSync("versions.json", "utf8"));
if (!(targetVersion in versions)) {
  versions[targetVersion] = minAppVersion;
  writeFileSync("versions.json", JSON.stringify(versions, null, 2) + "\n");
}
