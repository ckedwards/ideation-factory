import { Popover } from '@base-ui/react/popover'
import { isValidElement, type ReactElement, type ReactNode, useId } from 'react'
import './Tooltip.css'

// Details about something, shown beside it: what a state means, which of a
// team's requirements are met. Base UI's popover underneath, opening on hover,
// since what it says matters: Base UI's own tooltip is a visual hint only, not
// announced and off on touch screens.
//
// How it behaves:
// - opens after a delay on hover, and the pointer can move onto it
// - Enter or Space on the anchor opens it from the keyboard, and a tap does on
//   a touch screen; a screen reader hears it, named after the anchor
// - closes when the pointer leaves, on a click elsewhere, and on Esc, which
//   puts focus back on the anchor
// - a card above the anchor with an arrow (below, or shifted along, when
//   there's no room), in a portal so rows that clip their overflow don't cut
//   it off, and it follows the anchor as the page scrolls
const OPEN_DELAY = 600

export interface TooltipProps {
  // what it explains; only rendered while open
  content: ReactNode | (() => ReactNode)
  // the anchor: a Button, or with focusable, anything (an icon, a label)
  children: ReactNode
  className?: string
  // wrap the anchor in something focusable, when it isn't a button itself
  focusable?: boolean
}

export function Tooltip({ content, children, className, focusable = false }: TooltipProps) {
  const anchor = useId()
  const classes = ['tooltip-anchor', className].filter(Boolean).join(' ')
  const button = !focusable && isValidElement(children)
  return (
    <Popover.Root>
      {button ? (
        // a button already: it's the anchor itself
        <Popover.Trigger id={anchor} openOnHover delay={OPEN_DELAY} render={children as ReactElement} />
      ) : (
        <Popover.Trigger
          id={anchor}
          openOnHover
          delay={OPEN_DELAY}
          nativeButton={false}
          render={<span className={classes} tabIndex={0} />}
        >
          {children}
        </Popover.Trigger>
      )}
      <Popover.Portal>
        <Popover.Positioner className="tooltip-positioner" side="top" sideOffset={8} collisionPadding={8}>
          <Popover.Popup className="tooltip" aria-labelledby={anchor} initialFocus={false}>
            <Popover.Arrow className="tooltip-arrow" />
            {typeof content === 'function' ? content() : content}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
