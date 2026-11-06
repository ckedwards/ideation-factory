import type { Code, Nodes, RootContent } from 'mdast'
import { type ReactNode, useMemo } from 'react'
import { defaultImage, type ExternalImages, type ImageMedia } from './MarkdownImage.tsx'
import { MarkdownView, type ResolvedLink } from './MarkdownView.tsx'
import { type MarkdownSource, redline } from './redline.ts'

export interface RedlineProps {
  // the version compared against (an earlier one, or main) and the one shown
  base: MarkdownSource
  current: MarkdownSource
  // what an image's URL is in each version; an image whose answer differs is
  // shown before and after
  image?: (url: string) => ImageMedia
  baseImage?: (url: string) => ImageMedia
  externalImages?: ExternalImages
  resolveLink?: (url: string) => ResolvedLink
  renderCode?: (code: Code) => ReactNode | undefined
  idPrefix?: string
}

// Compare mode: the file rendered, with what changed since `base` shown in
// place. Edits show their words inserted and deleted, blocks added and removed
// are marked, a block that moved says where from, and a changed image shows
// before and after.
export function Redline({ base, current, image = defaultImage, baseImage = image, ...rest }: RedlineProps) {
  const blocks = useMemo(
    () =>
      redline(base, current, (before, after) => {
        const was = imagesIn(before).map((url) => JSON.stringify(baseImage(url)))
        const now = imagesIn(after).map((url) => JSON.stringify(image(url)))
        return was.join('\n') === now.join('\n')
      }),
    [base, current, image, baseImage],
  )
  return (
    <MarkdownView
      tree={current.tree}
      image={image}
      redline={{ blocks, base: base.tree, baseImage }}
      {...(rest.externalImages ? { externalImages: rest.externalImages } : {})}
      {...(rest.resolveLink ? { resolveLink: rest.resolveLink } : {})}
      {...(rest.renderCode ? { renderCode: rest.renderCode } : {})}
      {...(rest.idPrefix ? { idPrefix: rest.idPrefix } : {})}
    />
  )
}

// the URLs of the images in a block (reference-style ones too, by their label)
function imagesIn(node: Nodes | RootContent): string[] {
  if (node.type === 'image') {
    return [node.url]
  }
  if (node.type === 'imageReference') {
    return [`[${node.identifier}]`]
  }
  return 'children' in node ? node.children.flatMap((child) => imagesIn(child)) : []
}
