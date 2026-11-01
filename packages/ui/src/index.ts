// @ideaf/ui: the React components, design tokens and themes that every page is
// built from, shown in Storybook (`bun run storybook` here). Components take
// data as props and never fetch it. The app imports `@ideaf/ui/theme.css` once
// for the fonts, tokens and base styles; each component brings its own CSS.
export { Link, LinkProvider, type LinkProps } from './link/Link.tsx'

export { avatarColor, initials, type Person } from './people/person.ts'
export { Avatar, type AvatarProps, type AvatarSize } from './people/Avatar.tsx'
export { AvatarStack, type AvatarStackProps } from './people/AvatarStack.tsx'
export { UserName, type UserNameProps } from './people/UserName.tsx'
export { ActorLabel, type Actor, type ActorLabelProps } from './people/ActorLabel.tsx'

export { Tag, type TagProps, type TagTone } from './labels/Tag.tsx'
export { Highlight, findMatch, type HighlightProps } from './labels/Highlight.tsx'
export { TeamChip, type TeamChipProps, type TeamRef } from './teams/TeamChip.tsx'
export { GroupTag, type GroupRef, type GroupTagProps } from './teams/GroupTag.tsx'

export { StatusPill, type ClosedReason, type IdeaStatus, type StatusPillProps } from './ideas/StatusPill.tsx'
export {
  ideaState,
  isClosed,
  type IdeaInfo,
  type IdeaStateKey,
  type RequirementCheck,
  type Reviewer,
} from './ideas/idea.ts'
export { IdeaState, type IdeaStateProps } from './ideas/IdeaState.tsx'
export { ApprovalProgress, type ApprovalProgressProps } from './ideas/ApprovalProgress.tsx'
export { RequirementList } from './ideas/RequirementList.tsx'
export { ReviewerStack, type ReviewerStackProps } from './ideas/ReviewerStack.tsx'
export { IdeaRow, type IdeaRowHide, type IdeaRowProps } from './ideas/IdeaRow.tsx'

export { NowProvider, RelativeTime, formatAgo, useNow, type RelativeTimeProps } from './time/RelativeTime.tsx'

export { Button, type ButtonProps, type ButtonVariant } from './controls/Button.tsx'
export { SegmentedControl, type Segment, type SegmentedControlProps } from './controls/SegmentedControl.tsx'
export { ThemeToggle, applyTheme, type Theme, type ThemeToggleProps } from './controls/ThemeToggle.tsx'
export { SearchInput, type SearchInputProps } from './controls/SearchInput.tsx'
export { Select, type SelectOption, type SelectProps } from './controls/Select.tsx'
export { WatchSelect, WATCH_LEVELS, type WatchLevel, type WatchSelectProps } from './controls/WatchSelect.tsx'
export { Combobox, type ComboboxOption, type ComboboxProps } from './controls/Combobox.tsx'

export { Tooltip, type TooltipProps } from './overlays/Tooltip.tsx'
export { Dialog, type DialogProps } from './overlays/Dialog.tsx'
export { Toast, type ToastProps } from './overlays/Toast.tsx'

export { PageHeader, type PageHeaderProps } from './page/PageHeader.tsx'
export { Empty, type EmptyProps } from './page/Empty.tsx'

export {
  MarkdownView,
  defaultResolveLink,
  plainText,
  type MarkdownMark,
  type MarkdownViewProps,
  type ResolvedLink,
  type SectionMark,
} from './document/MarkdownView.tsx'
