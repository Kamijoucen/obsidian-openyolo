import type { Link, Parent, PhrasingContent, Root, Text } from 'mdast'

const WIKILINK_HREF_PREFIX = '#openyolo-wikilink='
const WIKILINK_PATTERN = /(!?)\[\[([^\]\n]+)\]\]/g

function wikilinkNode(raw: string, embedded: boolean): Link | Text {
  const separator = raw.indexOf('|')
  const target = (separator >= 0 ? raw.slice(0, separator) : raw).trim()
  const alias = (separator >= 0 ? raw.slice(separator + 1) : target).trim()
  if (!target)
    return { type: 'text', value: `${embedded ? '!' : ''}[[${raw}]]` }

  return {
    type: 'link',
    url: `${WIKILINK_HREF_PREFIX}${encodeURIComponent(target)}`,
    children: [
      {
        type: 'text',
        value: `${embedded ? '!' : ''}${alias || target}`,
      },
    ],
  }
}

function splitTextNode(node: Text): PhrasingContent[] {
  const result: PhrasingContent[] = []
  let cursor = 0
  for (const match of node.value.matchAll(WIKILINK_PATTERN)) {
    const index = match.index ?? 0
    if (index > cursor) {
      result.push({ type: 'text', value: node.value.slice(cursor, index) })
    }
    result.push(wikilinkNode(match[2] ?? '', match[1] === '!'))
    cursor = index + match[0].length
  }
  if (cursor < node.value.length) {
    result.push({ type: 'text', value: node.value.slice(cursor) })
  }
  return result.length > 0 ? result : [node]
}

function transformParent(parent: Parent): void {
  const nextChildren: Parent['children'] = []
  for (const child of parent.children) {
    if (child.type === 'text') {
      nextChildren.push(...splitTextNode(child))
      continue
    }
    // Existing Markdown links must stay literal; nested anchors are invalid.
    if ('children' in child && child.type !== 'link') {
      transformParent(child)
    }
    nextChildren.push(child)
  }
  parent.children = nextChildren
}

export function transformObsidianWikilinks(tree: Root): void {
  transformParent(tree)
}

export function remarkObsidianWikilinks(): (tree: Root) => void {
  return transformObsidianWikilinks
}

export function wikilinkTargetFromHref(href: string): string | null {
  if (!href.startsWith(WIKILINK_HREF_PREFIX)) return null
  try {
    return decodeURIComponent(href.slice(WIKILINK_HREF_PREFIX.length))
  } catch {
    return null
  }
}
