// The settings every package's stories share: src/storybook/preview.tsx.
// An object here, not the import itself, so Storybook can read it without running it.
import preview from '../src/storybook/preview.tsx'

export default { ...preview }
