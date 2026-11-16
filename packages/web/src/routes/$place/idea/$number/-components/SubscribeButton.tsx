// Subscribe / Unsubscribe on an idea, saying why you hear about it. Once
// unsubscribed, you hear nothing more, even as its author or a reviewer,
// unless someone asks you to review it.
import { Button, Tooltip } from '@ideaf/ui'

export type SubscriptionReason =
  | 'author'
  | 'review-requested'
  | 'group-review'
  | 'participating'
  | 'subscribed'
  | 'watching'

const WHY: Record<SubscriptionReason, string> = {
  author: 'You hear about it because you wrote it.',
  'review-requested': 'You hear about it because you were asked to review it.',
  'group-review': 'You hear about it because a group you’re in was asked to review it.',
  participating: 'You hear about it because you took part.',
  subscribed: 'You hear about it because you subscribed.',
  watching: 'You hear about it because you watch its team.',
}

export interface SubscribeButtonProps {
  subscribed: boolean
  reason: SubscriptionReason | null
  busy?: boolean
  onChange: (subscribed: boolean) => void
}

export function SubscribeButton({ subscribed, reason, busy = false, onChange }: SubscribeButtonProps) {
  const why = subscribed && reason ? WHY[reason] : 'You don’t hear about it, unless someone asks you to review it.'
  return (
    <Tooltip content={why}>
      <Button disabled={busy} onClick={() => onChange(!subscribed)}>
        {subscribed ? 'Unsubscribe' : 'Subscribe'}
      </Button>
    </Tooltip>
  )
}
