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

export { AccountMenu, type AccountMenuProps } from './people/AccountMenu.tsx'
export { CopyText, type CopyTextProps } from './labels/CopyText.tsx'
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
export { StatusControl, type OpenStatus, type StatusControlProps } from './ideas/StatusControl.tsx'
export { IdeaHeading, type IdeaHeadingProps } from './ideas/IdeaHeading.tsx'

export { NowProvider, RelativeTime, formatAgo, useNow, type RelativeTimeProps } from './time/RelativeTime.tsx'

export { Button, type ButtonProps, type ButtonVariant, LinkButton, type LinkButtonProps } from './controls/Button.tsx'
export { SegmentedControl, type Segment, type SegmentedControlProps } from './controls/SegmentedControl.tsx'
export { ThemeToggle, applyTheme, type Theme, type ThemeToggleProps } from './controls/ThemeToggle.tsx'
export { SearchInput, type SearchInputProps } from './controls/SearchInput.tsx'
export { Select, type SelectOption, type SelectProps } from './controls/Select.tsx'
export { Combobox, type ComboboxOption, type ComboboxProps } from './controls/Combobox.tsx'
export { TextArea, type TextAreaProps } from './controls/TextArea.tsx'
export { TextField, type TextFieldProps } from './controls/TextField.tsx'

export { Tooltip, type TooltipProps } from './overlays/Tooltip.tsx'
export { Dialog, type DialogProps } from './overlays/Dialog.tsx'
export { Toast, type ToastProps } from './overlays/Toast.tsx'

export { PageHeader, type PageHeaderProps } from './page/PageHeader.tsx'
export { Empty, type EmptyProps } from './page/Empty.tsx'

export {
  headings,
  type HeadingInfo,
  MarkdownView,
  defaultResolveLink,
  plainText,
  type MarkdownMark,
  type MarkdownViewProps,
  type ResolvedLink,
  type SectionMark,
} from './document/MarkdownView.tsx'
export { Toc, type TocEntry, type TocProps } from './document/Toc.tsx'
export {
  MarkdownImage,
  defaultImage,
  formatBytes,
  type ExternalImages,
  type ImageMedia,
  type MarkdownImageProps,
} from './document/MarkdownImage.tsx'
export { MermaidDiagram, renderMermaid, type MermaidDiagramProps } from './document/MermaidDiagram.tsx'
export { drawDiagram, preloadDiagrams, type Drawn } from './document/diagrams.ts'
export { Redline, type RedlineProps } from './document/Redline.tsx'
export {
  changedRanges,
  redline,
  type Deletion,
  type MarkdownSource,
  type RedlineBlock,
  type SourceRange,
} from './document/redline.ts'

export {
  CommentCard,
  type CommentCardProps,
  type CommentInfo,
  type CommentReply,
  type CommentTarget,
  type Suggestion,
} from './comments/CommentCard.tsx'
export { ViewInVersion, type ViewInVersionProps } from './comments/ViewInVersion.tsx'
export { CommentGutter, type CommentGutterProps } from './comments/CommentGutter.tsx'
export { layoutNotes, type GutterNote } from './comments/gutter.ts'
export { SelectionMenu, type SelectionMenuProps } from './comments/SelectionMenu.tsx'
export { selectionInSource, type TextSelection } from './comments/selection.ts'

export { Row, Stack, type RowProps, type Space, type StackProps } from './layout/Stack.tsx'
export { Page, Section, type PageProps, type SectionProps } from './layout/Page.tsx'
export { AppShell, type AppShellProps } from './layout/AppShell.tsx'
export { SideNav, type NavGroup, type NavItem, type SideNavProps } from './layout/SideNav.tsx'
export { Tabs, type Tab, type TabsProps } from './layout/Tabs.tsx'
export { IdeaPageLayout, type IdeaPageLayoutProps } from './layout/IdeaPageLayout.tsx'
