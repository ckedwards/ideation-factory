import { useState } from 'react'
import { Button } from '../controls/Button.tsx'

// An image a file refers to, as the page found it for the version shown.
// uploaded: the cli uploaded it with that version, so it's shown from here.
// not-uploaded: it's in the repository but wasn't uploaded, and why ("14.2 MB
// is over this deployment's 10 MB image limit", "not found").
// external: hosted on another site.
export type ImageMedia =
  | { status: 'uploaded'; src: string; name: string; bytes: number }
  | { status: 'not-uploaded'; reason: string }
  | { status: 'external'; src: string }

// The deployment's setting for images from other sites. always: shown.
// click: shown when the reader asks, so outside sites can't see who reads
// what. never: not loaded at all.
export type ExternalImages = 'always' | 'click' | 'never'

/** By default: a web address is external, and anything else wasn't uploaded. */
export function defaultImage(url: string): ImageMedia {
  return /^https?:/i.test(url)
    ? { status: 'external', src: url }
    : { status: 'not-uploaded', reason: 'not uploaded with this version' }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1000) {
    return `${bytes} B`
  }
  if (bytes < 1_000_000) {
    return `${Math.round(bytes / 100) / 10} KB`
  }
  return `${Math.round(bytes / 100_000) / 10} MB`
}

export interface MarkdownImageProps {
  alt: string
  media: ImageMedia
  externalImages: ExternalImages
}

// An image in a document, in whichever state it's in. Inline elements only,
// since an image sits inside a paragraph.
export function MarkdownImage({ alt, media, externalImages }: MarkdownImageProps) {
  const [shown, setShown] = useState(false)
  const label = alt || 'Image'
  if (media.status === 'uploaded') {
    return (
      <span className="md-image">
        <img src={media.src} alt={alt} loading="lazy" />
        <span className="md-image-caption">
          {alt && <>{alt} · </>}
          {media.name} · {formatBytes(media.bytes)}
        </span>
      </span>
    )
  }
  if (media.status === 'not-uploaded') {
    return (
      <span className="md-media md-media-missing">
        <span className="md-media-icon" aria-hidden>
          🖼
        </span>
        <span className="md-media-text">
          <strong>{label}</strong> · {media.reason}
        </span>
      </span>
    )
  }
  const host = hostOf(media.src)
  if (externalImages === 'always' || shown) {
    return (
      <span className="md-image md-image-external">
        <img src={media.src} alt={alt} loading="lazy" referrerPolicy="no-referrer" />
        <span className="md-image-caption">
          {alt && <>{alt} · </>}from {host}
        </span>
      </span>
    )
  }
  return (
    <span className="md-media">
      <span className="md-media-icon" aria-hidden>
        🖼
      </span>
      <span className="md-media-text">
        <strong>{label}</strong> · an image from {host}.{' '}
        {externalImages === 'never'
          ? 'This site doesn’t load images from other sites.'
          : 'Not loaded by itself, so the other site can’t see who reads this.'}
      </span>
      {externalImages === 'never' ? (
        <a href={media.src} target="_blank" rel="noopener noreferrer">
          Open it there
        </a>
      ) : (
        <Button size="sm" onClick={() => setShown(true)} aria-label={`Show the image ${label}, from ${host}`}>
          Show image
        </Button>
      )}
    </span>
  )
}

function hostOf(url: string): string {
  try {
    return new URL(url).host || 'another site'
  } catch {
    return 'another site'
  }
}
