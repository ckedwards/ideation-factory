// Back after a long gap (long-gap.ts): what only you changed is in the draft, and these are the
// paragraphs someone else changed too. Each shows yours and the draft's, side by side, and you keep
// one: "Use yours" puts yours over theirs, "Keep the draft's" lets yours go. It never says "block".
import { Button, Dialog, Stack } from '@ideaf/ui'
import type { NeedsALook } from './long-gap.ts'
import './LongGapReview.css'

export interface LongGapReviewProps {
  open: boolean
  items: NeedsALook[]
  /** The one being sent, while it is. */
  busy?: number | null
  onYours: (index: number) => void
  onTheirs: (index: number) => void
  onClose: () => void
}

const plural = (n: number) => (n === 1 ? '1 change' : `${n} changes`)

export function LongGapReview(props: LongGapReviewProps) {
  return (
    <Dialog open={props.open} title="What you typed while away" onClose={props.onClose}>
      <Stack gap={4}>
        <p className="long-gap-lead">
          You were away too long for your typing to merge as it went. What only you changed is in the draft. Someone
          else changed {props.items.length === 1 ? 'this' : 'these'} too, so choose which to keep:{' '}
          {plural(props.items.length)}.
        </p>
        <ol className="long-gap-items">
          {props.items.map((item, i) => (
            <li key={i} aria-labelledby={`long-gap-${i}`}>
              <h3 id={`long-gap-${i}`} className="long-gap-what">
                {item.what}
              </h3>
              <div className="long-gap-sides">
                <figure className="long-gap-side is-yours">
                  <figcaption>Yours</figcaption>
                  <Words text={item.yours} />
                </figure>
                <figure className="long-gap-side">
                  <figcaption>The draft now</figcaption>
                  <Words text={item.theirs} />
                </figure>
              </div>
              <div className="long-gap-buttons">
                {item.over && (
                  <Button size="sm" disabled={props.busy != null} onClick={() => props.onYours(i)}>
                    {props.busy === i ? 'Using yours…' : 'Use yours'}
                  </Button>
                )}
                <Button size="sm" variant="ghost" disabled={props.busy != null} onClick={() => props.onTheirs(i)}>
                  Keep the draft’s
                </Button>
              </div>
            </li>
          ))}
        </ol>
      </Stack>
    </Dialog>
  )
}

function Words({ text }: { text: string | null }) {
  if (!text) {
    return <p className="long-gap-words is-gone">Taken out</p>
  }
  return <p className="long-gap-words">{text}</p>
}
