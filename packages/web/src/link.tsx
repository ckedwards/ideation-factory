// The router's navigation for ui's links: components render a plain <a> with
// an href, and a plain click on one that stays on this site navigates in the
// app instead of loading the page again. Anything else (a new tab, another
// site, a download) is left to the browser.
import type { LinkProps } from '@ideaf/ui'
import { useRouter } from '@tanstack/react-router'

export function RouterLink({ href, onClick, ...rest }: LinkProps) {
  const router = useRouter()
  return (
    <a
      href={href}
      {...rest}
      onClick={(event) => {
        onClick?.(event)
        const modified = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
        if (event.defaultPrevented || event.button !== 0 || modified || rest.target || rest.download !== undefined) {
          return
        }
        const url = new URL(href, location.href)
        if (url.origin !== location.origin) {
          return
        }
        event.preventDefault()
        void router.navigate({ href: url.pathname + url.search + url.hash })
      }}
    />
  )
}
