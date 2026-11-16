import type { ButtonHTMLAttributes } from 'react'
import { Link, type LinkProps } from '../link/Link.tsx'
import './Button.css'

// default: most actions. primary: the one main action on a page or dialog.
// ghost: quiet, borderless (a close button). link: looks like text.
// danger: destructive (delete, remove someone's access).
export type ButtonVariant = 'default' | 'primary' | 'ghost' | 'link' | 'danger'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: 'sm' | 'md'
}

export function Button({ variant = 'default', size = 'md', type = 'button', className, ...rest }: ButtonProps) {
  const classes = ['button', `button-${variant}`, `button-${size}`, className].filter(Boolean).join(' ')
  return <button type={type} className={classes} {...rest} />
}

export type LinkButtonProps = LinkProps & Pick<ButtonProps, 'variant' | 'size'>

// A link that looks like a button: an action that goes to a page of its own (Sharing, Settings).
export function LinkButton({ variant = 'default', size = 'md', className, ...rest }: LinkButtonProps) {
  const classes = ['button', `button-${variant}`, `button-${size}`, className].filter(Boolean).join(' ')
  return <Link className={classes} {...rest} />
}
