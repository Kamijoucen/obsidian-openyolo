import type { Root } from 'mdast'

import {
  transformObsidianWikilinks,
  wikilinkTargetFromHref,
} from './obsidianMarkdown'

describe('Obsidian wikilinks', () => {
  it('turns wikilinks and aliases into internal Markdown links', () => {
    const tree: Root = {
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [
            {
              type: 'text',
              value: 'See [[Daily Note|today]] and [[Ideas#AI]].',
            },
          ],
        },
      ],
    }

    transformObsidianWikilinks(tree)

    expect(tree.children[0]).toMatchObject({
      children: [
        { type: 'text', value: 'See ' },
        {
          type: 'link',
          url: '#openyolo-wikilink=Daily%20Note',
          children: [{ type: 'text', value: 'today' }],
        },
        { type: 'text', value: ' and ' },
        {
          type: 'link',
          url: '#openyolo-wikilink=Ideas%23AI',
          children: [{ type: 'text', value: 'Ideas#AI' }],
        },
        { type: 'text', value: '.' },
      ],
    })
  })

  it('keeps existing Markdown link labels free of nested anchors', () => {
    const tree: Root = {
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [
            {
              type: 'link',
              url: 'https://example.com',
              children: [{ type: 'text', value: '[[literal]]' }],
            },
          ],
        },
      ],
    }

    transformObsidianWikilinks(tree)

    expect(tree.children[0]).toMatchObject({
      children: [
        {
          type: 'link',
          children: [{ type: 'text', value: '[[literal]]' }],
        },
      ],
    })
  })

  it('decodes click targets and rejects unrelated or malformed hrefs', () => {
    expect(wikilinkTargetFromHref('#openyolo-wikilink=Folder%2FNote')).toBe(
      'Folder/Note',
    )
    expect(wikilinkTargetFromHref('/normal.md')).toBeNull()
    expect(wikilinkTargetFromHref('#openyolo-wikilink=%E0%A4%A')).toBeNull()
  })
})
