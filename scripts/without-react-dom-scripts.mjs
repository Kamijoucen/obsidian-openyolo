import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

// React DOM 19.3.1 ships script resource loading even when the app never uses it.
// Review the upstream renderer and these edits together when upgrading React DOM.
const rendererDigests = {
  production:
    'a319b413b7a19ee34422d9a12a8e7afd003c07846716d278ba1a0898e8cb6251',
  development:
    'f6b7e0de965d24a560efa784ef8a63706dea79fa551bee15a37acd015d995106',
}

const rejectScript =
  'throw new Error("OpenYOLO does not load or render scripts through React DOM.");'

function replace(source, pattern, replacement) {
  const contents = source.replace(pattern, replacement)
  if (contents === source) {
    throw new Error(
      `Could not disable a React DOM script path matching ${pattern}`,
    )
  }
  return contents
}

function removeScriptLoading(source, mode) {
  const digest = createHash('sha256').update(source).digest('hex')
  if (digest !== rendererDigests[mode]) {
    throw new Error(
      `Review the script removal patch for this React DOM ${mode} build.`,
    )
  }

  // Reject script elements before React chooses a host namespace or hoists them.
  let contents = replace(
    source,
    /(^[ \t]*function createFiberFromTypeAndProps\([\s\S]*?^[ \t]*\) \{\n)([ \t]+)(?=var fiberTag)/m,
    (_, signature, indent) =>
      `${signature}${indent}if (typeof type === "string" && type.toLowerCase() === "script") ${rejectScript}\n${indent}`,
  )

  // Remove both normal element and hoisted resource implementations.
  contents = replace(
    contents,
    /^([ \t]*)case "script":\n[ \t]+nextResource = (?:ownerDocument|nextResource)\.createElement\("div"\);[\s\S]*?(?=^\1case "select":)/m,
    `$1case "script":\n$1  ${rejectScript}\n`,
  )
  contents = replace(
    contents,
    /^([ \t]*)case "script":\n[ \t]+(?:instance\$274|_instance) = getScriptKey\(props\.src\);[\s\S]*?(?=^\1case "void":)/m,
    `$1case "script":\n$1  ${rejectScript}\n`,
  )

  if (mode === 'production') {
    return replace(
      contents,
      /^function preinitScript\(src, options\) \{[\s\S]*?(?=^function getResource\()/m,
      `function preinitScript() { ${rejectScript} }\nfunction preinitModuleScript() { ${rejectScript} }\n`,
    )
  }

  // The development dispatcher implements these operations inline.
  for (const operation of ['X', 'M']) {
    const implementation = new RegExp(
      `^([ \\t]*)${operation}: function \\(src, options\\) \\{\\n[ \\t]+previousDispatcher\\.${operation}\\(src, options\\);[\\s\\S]*?^\\1\\}`,
      'm',
    )
    contents = replace(
      contents,
      implementation,
      `$1${operation}: function () { ${rejectScript} }`,
    )
  }
  return contents
}

export const withoutReactDomScripts = {
  name: 'without-react-dom-scripts',
  setup(build) {
    const filter =
      /[\\/]react-dom[\\/]cjs[\\/]react-dom-client\.(production|development)\.js$/
    build.onLoad({ filter }, async ({ path }) => {
      const mode = path.match(filter)[1]
      const source = await readFile(path, 'utf8')
      return { contents: removeScriptLoading(source, mode), loader: 'js' }
    })
    build.onEnd(({ errors, metafile }) => {
      if (errors.length > 0) return
      const inputs = Object.keys(metafile?.inputs ?? {})
      if (!inputs.some((path) => filter.test(path))) {
        return {
          errors: [
            {
              text: 'The patched React DOM renderer is missing from the build.',
            },
          ],
        }
      }
    })
  },
}
