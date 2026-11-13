// The seeded world, worked out from indexes so the seeder and the k6 scripts
// agree without sharing tables: who's in which team and group, which team an
// idea is in, and the words ideas are written in (so searches find something).
// Plain TypeScript: it runs in Bun (the seeder) and in k6.

/** The teams person i is in: i % teams first, so person t + teams × n is always in team t. */
export function memberTeams(i: number, teams: number): number[] {
  return [...new Set([i % teams, (i * 7 + 3) % teams, (i * 13 + 5) % teams])]
}

/** The ten people in group g. */
export function groupMembers(g: number, people: number): number[] {
  return [...new Set(Array.from({ length: 10 }, (_, k) => (g * 5 + k * 997) % people))]
}

/** The team idea j is in; team t's ideas are t, t + teams, t + 2 × teams, … */
export function ideaTeam(j: number, teams: number): number {
  return j % teams
}

/** The person who made team t, its first admin (and the maker of its ideas). */
export function teamAdmin(t: number, people: number): number {
  return (t * 7) % people
}

/** Person i's own address, sent in X-Forwarded-For, so rate limits count each person apart. */
export function personIp(i: number): string {
  const n = i + 1
  return `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`
}

export const WORDS = (
  'anchor archive audit backlog badge banner beacon budget cache canvas chart checkout cluster comment compass ' +
  'contract cursor dashboard deadline debit delivery deploy digest draft editor engine export feedback filter ' +
  'forecast gateway glossary harbor heatmap horizon inbox invoice journey kanban keyboard ladder ledger license ' +
  'lighthouse lineage locale magnet marker meadow metric migration mobile monitor network notebook offline onboard ' +
  'orbit outline palette parcel payroll pipeline pivot planner portal preview pricing printer profile prototype ' +
  'quarter quota radar ranking receipt referral release reminder replay report research review roadmap rollout ' +
  'router runway sandbox schedule search segment sensor session shipping signal sitemap sketch snapshot sprint ' +
  'storage summary support survey switch tablet tagging telemetry template tenant ticket timeline toolbar tracker ' +
  'trial upgrade upload vendor version voucher wallet webhook widget wizard workflow workshop'
).split(' ')

/** A small deterministic generator, so the same index always gives the same words. */
function words(seed: number, count: number): string[] {
  let x = (seed * 2654435761) >>> 0
  return Array.from({ length: count }, () => {
    x = (x * 1103515245 + 12345) >>> 0
    return WORDS[x % WORDS.length]!
  })
}

export function ideaTitle(j: number): string {
  return `Idea ${j}: ${words(j, 3).join(' ')}`
}

/** Idea j's one file: about 2 KB of headings and paragraphs, like a short proposal. */
export function ideaDocument(j: number): string {
  const sections = ['Problem', 'Proposal', 'Risks', 'Next steps']
  const body = sections.map((heading, s) => {
    const paragraphs = [0, 1].map((p) => {
      const sentence = (n: number) => {
        const w = words(j * 31 + s * 7 + p * 3 + n, 8)
        return `${w[0]![0]!.toUpperCase()}${w.join(' ').slice(1)}.`
      }
      return [0, 1, 2].map(sentence).join(' ')
    })
    return `## ${heading}\n\n${paragraphs.join('\n\n')}`
  })
  return `# ${ideaTitle(j)}\n\n${body.join('\n\n')}\n`
}
