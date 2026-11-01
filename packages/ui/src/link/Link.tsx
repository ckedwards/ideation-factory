// Links inside components. Components know where a link goes (an href) but
// not how the app navigates, so they render this, and the app supplies its
// router's link through LinkProvider. Without one, it's a plain <a>.
import { createContext, useContext, type AnchorHTMLAttributes, type ComponentType } from 'react'

export type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }

const LinkContext = createContext<ComponentType<LinkProps>>((props) => <a {...props} />)

export const LinkProvider = LinkContext.Provider

export function Link(props: LinkProps) {
  const Component = useContext(LinkContext)
  return <Component {...props} />
}
