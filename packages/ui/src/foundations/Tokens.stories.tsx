// The design tokens, shown: every color in the current theme, the type and
// the spacing scale. An organization checking a re-theme starts here.
import type { Meta, StoryObj } from '@storybook/react-vite'
import './Tokens.css'

const colors: [group: string, tokens: string[]][] = [
  ['Surfaces and text', ['bg', 'surface', 'surface-2', 'surface-3', 'ink', 'ink-2', 'ink-3', 'rule', 'rule-strong']],
  ['Accent', ['accent', 'accent-ink', 'accent-soft']],
  ['Highlights', ['mark', 'mark-active', 'mark-line']],
  ['Bots and admins', ['bot', 'bot-soft', 'admin', 'admin-soft']],
  ['Changes', ['ins-bg', 'ins-ink', 'del-bg', 'del-ink', 'changed']],
  ['States', ['ok', 'warn', 'lost']],
  ['Avatars', ['avatar-1', 'avatar-2', 'avatar-3', 'avatar-4', 'avatar-5', 'avatar-6', 'avatar-7', 'avatar-8']],
]

const fonts = [
  ['font-display', 'Headings', 'Source Serif 4'],
  ['font-prose', 'Reading', 'Literata'],
  ['font-ui', 'Interface', 'Inter'],
  ['font-mono', 'Code', 'JetBrains Mono'],
]

const sizes = ['text-xs', 'text-sm', 'text-md', 'text-lg', 'text-prose']
const spaces = ['space-1', 'space-2', 'space-3', 'space-4', 'space-5', 'space-6', 'space-7', 'space-8']

const meta = { title: 'Foundations/Tokens' } satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const Colors: Story = {
  render: () => (
    <div className="tokens">
      {colors.map(([group, tokens]) => (
        <section key={group}>
          <h2>{group}</h2>
          <ul className="tokens-swatches">
            {tokens.map((token) => (
              <li key={token}>
                <span className="tokens-swatch" style={{ background: `var(--${token})` }} />
                <code>--{token}</code>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  ),
}

export const Type: Story = {
  render: () => (
    <div className="tokens">
      <section>
        <h2>Typefaces</h2>
        {fonts.map(([token, use, name]) => (
          <p key={token} className="tokens-font" style={{ fontFamily: `var(--${token})` }}>
            {use}: {name} <code>--{token}</code>
          </p>
        ))}
      </section>
      <section>
        <h2>Sizes</h2>
        {sizes.map((token) => (
          <p key={token} style={{ fontSize: `var(--${token})` }}>
            The comment survives the move <code>--{token}</code>
          </p>
        ))}
      </section>
    </div>
  ),
}

export const Spacing: Story = {
  render: () => (
    <div className="tokens">
      <section>
        <h2>Space</h2>
        {spaces.map((token) => (
          <div key={token} className="tokens-space">
            <span className="tokens-bar" style={{ width: `var(--${token})` }} />
            <code>--{token}</code>
          </div>
        ))}
      </section>
    </div>
  ),
}
