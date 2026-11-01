// Example data for the stories: the people, teams and groups from the
// prototypes, plus the awkward cases (long names, inactive people, crowds).
import type { Person } from '../people/person.ts'
import type { Actor } from '../people/ActorLabel.tsx'

export const riley: Person = { id: 'u-riley', name: 'Riley Park', handle: 'riley' }
export const maya: Person = { id: 'u-maya', name: 'Maya Ortiz', handle: 'maya' }
export const devon: Person = { id: 'u-devon', name: 'Devon Fox', handle: 'dfox' }
export const sam: Person = { id: 'u-sam', name: 'Sam Achebe', handle: 'sam' }
export const priya: Person = { id: 'u-priya', name: 'Priya Raman', handle: 'priya' }
export const jonas: Person = { id: 'u-jonas', name: 'Jonas Weber', handle: 'jweber', inactive: true }
export const longName: Person = {
  id: 'u-long',
  name: 'Maximiliana Alexandra Bartholomew-Featherstonehaugh',
  handle: 'maximiliana.featherstonehaugh',
}

// A picture, inline so the stories need no network
export const withPicture: Person = {
  id: 'u-alex',
  name: 'Alex Kim',
  handle: 'alex',
  avatarUrl:
    'data:image/svg+xml,' +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#3d6b8f"/><circle cx="32" cy="25" r="12" fill="#f2d6b8"/><path d="M10 64c2-14 11-21 22-21s20 7 22 21z" fill="#f2d6b8"/></svg>',
    ),
}

export const everyone: Person[] = [riley, maya, devon, sam, priya, jonas]

// A crowd, for "+N more"
export const crowd: Person[] = Array.from({ length: 40 }, (_, i) => ({
  id: `u-crowd-${i}`,
  name: `${['Ada', 'Ben', 'Cleo', 'Dev', 'Eli', 'Fay', 'Gus', 'Hana'][i % 8]} ${['Lee', 'Moss', 'Noor', 'Okafor', 'Park'][i % 5]}`,
}))

export const actors = {
  person: { kind: 'person', person: riley },
  botForPerson: { kind: 'bot-for-person', bot: 'planbot', person: riley },
  bot: { kind: 'bot', bot: 'archbot' },
  inactivePerson: { kind: 'person', person: jonas },
  botForInactive: { kind: 'bot-for-person', bot: 'typobot', person: jonas },
  longNames: { kind: 'bot-for-person', bot: 'requirements-consistency-checker', person: longName },
} satisfies Record<string, Actor>
