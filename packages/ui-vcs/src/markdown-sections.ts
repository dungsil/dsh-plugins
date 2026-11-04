import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { mathFromMarkdown } from 'mdast-util-math'
import { gfm } from 'micromark-extension-gfm'
import { math } from 'micromark-extension-math'

export interface MarkdownSection {
  heading: string
  content: string
  children: MarkdownSection[]
}

export function splitMarkdownSections(text: string) {
  const document = fromMarkdown(text, {
    extensions: [gfm(), math()],
    mdastExtensions: [gfmFromMarkdown(), mathFromMarkdown()],
  })
  const headings = document.children.filter((node) => node.type === 'heading')
  const sections: MarkdownSection[] = []
  const parents: { depth: number; section: MarkdownSection }[] = []
  for (const [index, heading] of headings.entries()) {
    const section: MarkdownSection = {
      heading: text.slice(heading.position!.start.offset!, heading.position!.end.offset!),
      content: text.slice(heading.position!.end.offset!, headings[index + 1]?.position!.start.offset),
      children: [],
    }
    while (parents.length && parents.at(-1)!.depth >= heading.depth) parents.pop()
    const siblings = parents.at(-1)?.section.children ?? sections
    siblings.push(section)
    parents.push({ depth: heading.depth, section })
  }
  return {
    introduction: text.slice(0, headings[0]?.position!.start.offset),
    sections,
    // Each renderer needs the document's shared link and footnote definitions.
    definitions: document.children
      .filter((node) => node.type === 'definition' || node.type === 'footnoteDefinition')
      .map((node) => text.slice(node.position!.start.offset!, node.position!.end.offset!))
      .join('\n\n'),
  }
}
