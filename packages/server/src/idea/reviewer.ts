// The account a review is from: a person, or a bot (each bot apart from the
// person it acts for). Verdicts and pending comments are kept by it.
import type { Caller } from '@ideaf/api'

export function reviewerOf(caller: Caller): string {
  return caller.purpose === 'me' ? `u:${caller.user}` : `b:${caller.user}:${caller.bot ?? ''}`
}
