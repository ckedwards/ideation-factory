// Every page of an idea, in one frame drawn once by the idea's route, so
// nothing about the idea moves when you go from one of its pages to another:
// a bar with the way out (the product's mark for Home, the team), its title,
// its status, its version, and what can be done with it (Subscribe, Sharing,
// your review, and the rest behind ⋯), then your notifications and account;
// and its tabs under that. The site's navigation steps aside, as the idea's
// pages have side columns of their own. Sharing, your review and closing open
// as dialogs over whichever page is shown. A page can put the idea in a mode
// (IdeaMode: editing its draft): the bar then says so and has the mode's
// actions where its own were, and the tabs wait until the mode ends.
import { createContext, type ReactNode, useContext, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { AccountMenu, Button, Dialog, InboxLink, Link, RelativeTime, RowMenu, Toast } from '@ideaf/ui'
import { useLiveSuspenseQuery } from '@tanstack/react-db'
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { api, meQuery, teamQuery, unreadQuery } from '../../../../../api.ts'
import { useSite } from '../../../../../site.tsx'
import { IdeaTabs } from './IdeaTabs.tsx'
import type { IdeaLinks } from './links.ts'
import { commentsOf } from './live.ts'
import { filesQuery, ideaQuery, subscriptionQuery } from './queries.ts'
import { CloseDialog, IdeaStatus, ReviewButton } from './ReviewPanel.tsx'
import { useReview } from './review.tsx'
import { SharingPanel } from './SharingPanel.tsx'
import { teamRef, usePeople } from './shared.tsx'
import { SubscribeButton } from './SubscribeButton.tsx'
import './IdeaFrame.css'

export interface IdeaFrameProps {
  id: string
  links: IdeaLinks
  /** The tab shown, or none on a page that isn't one (moving it). */
  current: 'overview' | 'files' | null
  /** Its Sharing dialog is open (?sharing), and closing it. */
  sharing: boolean
  onSharing: (open: boolean) => void
  /** The page. */
  children: ReactNode
}

/** Where a mode's words and actions go in the bar, and saying one has begun or ended. */
const ModeContext = createContext<{ slot: HTMLElement | null; setActive: (active: boolean) => void } | null>(null)

/**
 * The idea in a mode, while this is shown: its words (what's going on) and its
 * actions (how to finish it) in the idea's bar, in place of the bar's own.
 */
export function IdeaMode({ label, actions }: { label: ReactNode; actions: ReactNode }) {
  const mode = useContext(ModeContext)
  const setActive = mode?.setActive
  useEffect(() => {
    setActive?.(true)
    return () => setActive?.(false)
  }, [setActive])
  if (!mode?.slot) {
    return null
  }
  return createPortal(
    <>
      <span className="idea-bar-mode-label">{label}</span>
      {actions}
    </>,
    mode.slot,
  )
}

export function IdeaFrame({ id, links, current, sharing, onSharing, children }: IdeaFrameProps) {
  const queryClient = useQueryClient()
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  const [moded, setModed] = useState(false)
  const navigate = useNavigate()
  const site = useSite()
  const { data: idea } = useSuspenseQuery(ideaQuery(id))
  const { data: me } = useSuspenseQuery(meQuery)
  const { data: pulled } = useSuspenseQuery(filesQuery(id, idea.latest))
  const team = useQuery({ ...teamQuery(idea.team ?? ''), enabled: idea.team !== null })
  const unread = useQuery(unreadQuery).data ?? 0
  const subscription = useQuery(subscriptionQuery(id))
  const [subscribing, setSubscribing] = useState(false)
  const [closing, setClosing] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const people = usePeople([idea.owner])
  const review = useReview(id, setNote)
  // your pending comments, as they are now: the button counts them the moment one's added, on any page
  const { data: threads } = useLiveSuspenseQuery((q) => q.from({ thread: commentsOf(id, queryClient) }))
  const pending = threads.flatMap((t) => [t, ...t.replies]).filter((c) => c.pending).length
  const where = teamRef(idea, team.data, people, me.id)
  // the browser's tab names the idea, so several open can be told apart
  useEffect(() => {
    const before = document.title
    document.title = `${idea.title} · ${where.name}`
    return () => {
      document.title = before
    }
  }, [idea.title, where.name])
  const latest = idea.versions.find((v) => v.number === idea.latest)
  const closed = review.status.status === 'closed'
  const address = links.overview.replace(/^\//, '')

  return (
    <div className="idea-frame">
      <header className="idea-bar">
        <div className="idea-bar-where">
          <Link className="idea-bar-mark" href="/" aria-label="Home" title="Home">
            <span aria-hidden>✳</span>
          </Link>
          {where.href ? (
            <Link className="idea-bar-team" href={where.href}>
              {where.name}
            </Link>
          ) : (
            <span className="idea-bar-team">{where.name}</span>
          )}
          <span className="idea-bar-slash" aria-hidden>
            /
          </span>
          <h1 className="idea-bar-title" title={idea.title}>
            {idea.title}
          </h1>
          <IdeaStatus {...review} />
          <span className="idea-bar-version">
            v{idea.latest}
            {latest && (
              <>
                {' · '}
                <RelativeTime at={latest.createdAt} />
              </>
            )}
          </span>
        </div>
        {/* a mode's words and actions, when a page has put the idea in one */}
        <div className="idea-bar-mode" ref={setSlot} />
        {!moded && (
          <div className="idea-bar-actions">
            {subscription.data && (
              <SubscribeButton
                subscribed={subscription.data.subscribed}
                reason={subscription.data.reason}
                busy={subscribing}
                onChange={(subscribed) => {
                  setSubscribing(true)
                  api
                    .setSubscription({ idea: id, subscribed })
                    .then((now) => queryClient.setQueryData(subscriptionQuery(id).queryKey, now))
                    .catch((error: unknown) => setNote(error instanceof Error ? error.message : String(error)))
                    .finally(() => setSubscribing(false))
                }}
              />
            )}
            <Button onClick={() => onSharing(true)}>Sharing</Button>
            <ReviewButton {...review} pending={pending} />
            <RowMenu
              label="This idea"
              groups={[
                {
                  items: [
                    ...(review.canEdit && !closed ? [{ label: 'Close…', onSelect: () => setClosing(true) }] : []),
                    ...(review.canEdit && closed ? [{ label: 'Reopen', onSelect: review.onReopen }] : []),
                    ...(idea.you.share
                      ? [{ label: 'Move…', onSelect: () => void navigate({ href: links.move }) }]
                      : []),
                    {
                      label: 'Copy its address',
                      onSelect: () =>
                        void navigator.clipboard
                          .writeText(address)
                          .then(() => setNote(`Copied ${address}`))
                          .catch(() => setNote(`Its address is ${address}`)),
                    },
                  ],
                },
              ]}
            />
          </div>
        )}
        <div className="idea-bar-site">
          <InboxLink href="/notifications" unread={unread} />
          <AccountMenu
            compact
            person={me}
            settingsHref="/settings"
            theme={site.theme}
            onThemeChange={site.onThemeChange}
            onSignOut={site.onSignOut}
          />
        </div>
      </header>
      {/* the tabs wait while a mode is on: leaving is the mode's to do */}
      <div className={`idea-frame-tabs${moded ? ' is-waiting' : ''}`} inert={moded}>
        <IdeaTabs current={current} overview={links.overview} files={links.files()} fileCount={pulled.files.length} />
      </div>
      <ModeContext.Provider value={{ slot, setActive: setModed }}>
        <div className="idea-frame-page">{children}</div>
      </ModeContext.Provider>
      <Dialog open={sharing} title="Sharing" onClose={() => onSharing(false)}>
        <SharingPanel id={id} links={links} />
      </Dialog>
      <CloseDialog
        open={closing}
        onOpenChange={setClosing}
        onClose={review.onClose}
        blocked={review.reviews.filter((r) => r.standing)}
        unmet={review.requirements.filter((c) => !c.met).length}
      />
      <Toast message={note} onDismiss={() => setNote(null)} />
    </div>
  )
}
