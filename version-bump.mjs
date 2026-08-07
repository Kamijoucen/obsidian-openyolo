import { readFileSync, writeFileSync } from 'node:fs'

const targetVersion = process.argv[2]
if (!targetVersion) {
  console.error('Please provide a target version as a command line argument.')
  process.exit(1)
}
if (!/^\d+\.\d+\.\d+$/.test(targetVersion)) {
  console.error('Version must be a bare stable SemVer, for example 1.0.9.')
  process.exit(1)
}

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const writeJson = (path, value) =>
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)

// read minAppVersion from manifest.json and bump version to target version
const manifest = readJson('manifest.json')
const { minAppVersion } = manifest
if (typeof minAppVersion !== 'string' || !minAppVersion.trim()) {
  console.error('manifest.json minAppVersion must be a non-empty string.')
  process.exit(1)
}
manifest.version = targetVersion

// update versions.json with target version and minAppVersion from manifest.json
const versions = readJson('versions.json')
versions[targetVersion] = minAppVersion

// update package metadata and its root lockfile entry
const packageJson = readJson('package.json')
packageJson.version = targetVersion
const packageLock = readJson('package-lock.json')
const rootPackage = packageLock.packages?.['']
if (!rootPackage) {
  console.error('package-lock.json is missing the root package entry.')
  process.exit(1)
}
packageLock.version = targetVersion
rootPackage.version = targetVersion

writeJson('manifest.json', manifest)
writeJson('versions.json', versions)
writeJson('package.json', packageJson)
writeJson('package-lock.json', packageLock)

console.log(
  `Updated OpenYOLO to ${targetVersion}. Run npm run build before committing.`,
)
