// Small line icons, drawn at 16px in the text's colour: for telling kinds of
// thing apart at a glance (a comment, an approval, a new version), never as
// the only label. Each is a few strokes on a 16-unit grid.
import type { ReactNode } from 'react'
import './Icon.css'

const PATHS = {
  // a speech bubble
  comment: <path d="M2.5 3.5h11v7.5h-6L4.5 13.5V11h-2z" />,
  // an arrow back and down
  reply: <path d="M6 3.5 2.5 7 6 10.5M2.5 7h7a4 4 0 0 1 4 4v1.5" />,
  // a pencil
  suggestion: <path d="M10.5 2.5l3 3-8 8h-3v-3zM9 4l3 3" />,
  // a tick in a circle
  review: (
    <>
      <circle cx="8" cy="8" r="5.75" />
      <path d="M5.5 8.25l1.75 1.75 3.25-3.5" />
    </>
  ),
  // a struck-through circle
  dismissed: (
    <>
      <circle cx="8" cy="8" r="5.75" />
      <path d="M3.9 12.1l8.2-8.2" />
    </>
  ),
  // an arrow along
  status: <path d="M2.5 8h11M9.5 4l4 4-4 4" />,
  // an arrow up from a line: something new on top
  version: <path d="M8 11V2.5M4.5 6 8 2.5 11.5 6M3 13.5h10" />,
  // a tick in a box
  decided: (
    <>
      <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
      <path d="M5.25 8.25l1.75 1.75 3.75-4" />
    </>
  ),
  // an eye: asked to look at it
  requested: (
    <>
      <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
      <circle cx="8" cy="8" r="2" />
    </>
  ),
  // a dot: anything else
  update: <circle cx="8" cy="8" r="2.5" />,
  // two people: a team or a group, and what changed in it
  group: (
    <>
      <circle cx="6" cy="5.5" r="2.25" />
      <path d="M2 13.25c.4-2.3 1.9-3.6 4-3.6s3.6 1.3 4 3.6" />
      <circle cx="11.5" cy="6.25" r="1.75" />
      <path d="M11.25 9.75c1.6.15 2.75 1.3 3.1 3.5" />
    </>
  ),
  // a chevron down: a menu opens here
  menu: <path d="M4 6.5l4 4 4-4" />,
  // an envelope: your notifications
  inbox: (
    <>
      <rect x="1.75" y="3.25" width="12.5" height="9.5" rx="1.5" />
      <path d="M2.25 4.5 8 9l5.75-4.5" />
    </>
  ),
  // a folder, closed and open: the Files tree's folders
  folder: <path d="M2.5 4.5a1 1 0 0 1 1-1h3l1.5 1.5h4.5a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z" />,
  folderOpen: (
    <path d="M2.5 12V4.5a1 1 0 0 1 1-1h3l1.5 1.5h4a1 1 0 0 1 1 1v1M2.5 12l1.6-4.4a1 1 0 0 1 .9-.6h8.6a.6.6 0 0 1 .6.8L12.6 12a1 1 0 0 1-.9.5h-8.7a.5.5 0 0 1-.5-.5z" />
  ),
  // a page with lines of text: a file
  page: (
    <>
      <path d="M4 2.5h5l3 3v8H4z" />
      <path d="M9 2.5v3h3M6 8.5h4M6 11h3" />
    </>
  ),
  // a picture: an image file
  image: (
    <>
      <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
      <path d="M2.5 11l3.5-3.5 3 3 1.75-1.75 2.75 2.75" />
      <circle cx="10.5" cy="6" r="1" />
    </>
  ),
} satisfies Record<string, ReactNode>

export type IconName = keyof typeof PATHS

export const ICON_NAMES = Object.keys(PATHS) as IconName[]

export interface IconProps {
  name: IconName
  /** Hidden from screen readers unless it has a label: the words beside it say the same. */
  label?: string
}

export function Icon({ name, label }: IconProps) {
  return (
    <svg
      className="icon"
      viewBox="0 0 16 16"
      width="16"
      height="16"
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    >
      {PATHS[name]}
    </svg>
  )
}
