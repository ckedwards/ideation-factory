// The server's settings: ideaf.yaml's keys, each also an environment variable named for its path
// (files.s3.bucket is IDEAF__FILES__S3__BUCKET), and the secrets among them, which belong in
// secrets.yaml, the environment or a file of their own (load.ts). Checked when the server starts:
// a mistake is named by its key, and the server doesn't start.
//
// From the environment every value is a string, so lists also take "a,b,c", numbers "42", and
// on/off switches "on" or "off".
import { z } from 'zod'
import { DEFAULT_DRAFT_LIMITS, DEFAULT_LIMITS, LIMIT_RANGES } from '../limits.ts'

const PERSONAL_TOKEN_POLICIES = ['on', 'admins', 'off'] as const

/** A list: YAML's, or a comma-separated string (the environment's). */
const list = z.preprocess(
  (value) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean)
      : value,
  z.array(z.string().trim().min(1)),
)

/** A whole number, from YAML or a string. */
const whole = (min: number, max: number) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() !== '' ? Number(value) : value),
    z
      .number({ error: `a whole number from ${min} to ${max}` })
      .int({ error: `a whole number from ${min} to ${max}` })
      .min(min, { error: `a whole number from ${min} to ${max}` })
      .max(max, { error: `a whole number from ${min} to ${max}` }),
  )

/** on or off, as YAML's true and false too. */
const onOff = z.preprocess(
  (value) => (value === true ? 'on' : value === false ? 'off' : value),
  z.enum(['on', 'off'], { error: (issue) => `on or off, not ${JSON.stringify(issue.input)}` }),
)

const choice = <const T extends readonly [string, ...string[]]>(values: T) =>
  z.enum(values, { error: (issue) => `${values.join(', ')}, not ${JSON.stringify(issue.input)}` })

const text = z.string().trim().min(1)

export const settingsSchema = z.strictObject({
  url: text.optional().describe("The deployment's public URL (http://localhost:<port> unless set)."),
  port: whole(1, 65535).default(8080).describe('The port this process serves on.'),
  data: text
    .default('.data')
    .describe("Where this machine keeps the app's own files (ideas' files, without a bucket)."),
  site_admins: list.default([]).describe("The site admins' emails."),
  trusted_proxies: list
    .default([])
    .describe(
      'The reverse proxies (load balancers) in front of the app, IPs or CIDR ranges, whose X-Forwarded-For is believed.',
    ),

  /** The Rivet Engine this node joins: RivetKit's RIVET_* variables, if set, win. */
  engine: z
    .strictObject({
      endpoint: text
        .optional()
        .describe('Its API, like http://127.0.0.1:6420. In development, without it, RivetKit starts an engine itself.'),
      token: text.optional().describe('Its admin token: a secret.'),
      namespace: text.default('default'),
      pool: text
        .optional()
        .describe("The node pool this process joins: default for the app, the directory's for a directory process."),
      node_version: whole(1, Number.MAX_SAFE_INTEGER)
        .optional()
        .describe(
          "The node version the engine places actors by: the build's own unless set, the same on every machine.",
        ),
    })
    .default({ namespace: 'default' }),

  directory: z
    .strictObject({
      pool: text
        .optional()
        .describe("The directory's pool: its own nodes' (a pool of its own), or the app's unless set."),
      calls: whole(1, 1024)
        .default(4)
        .describe('How many calls this node sends the directory at once (actors/limit.ts).'),
    })
    .default({ calls: 4 }),

  auth: z
    .strictObject({
      secret: z
        .string()
        .min(32, { error: 'at least 32 characters' })
        .optional()
        .describe(
          'Signs cookies and encrypts the signing keys: a secret, at least 32 characters, required in production.',
        ),
      personal_tokens: choice(PERSONAL_TOKEN_POLICIES)
        .default('admins')
        .describe('Who may use personal tokens: on, admins or off.'),
      scim_token: z
        .string()
        .min(32, { error: 'at least 32 characters' })
        .optional()
        .describe(
          "The identity provider's SCIM bearer token: a secret, at least 32 characters; SCIM is off without it.",
        ),
      sso: z
        .strictObject({
          mode: choice(['off', 'oidc', 'saml']).default('off'),
          name: text.default('single sign-on').describe('Shown as "Continue with <name>".'),
          domains: list.default([]).describe('The email domains that can sign in with it (required with it on).'),
          auto_create: onOff
            .default('on')
            .describe('Make an account for someone new; off refuses them until someone adds them.'),
          oidc: z
            .strictObject({
              issuer: text.optional(),
              client_id: text.optional(),
              client_secret: text.optional().describe('A secret.'),
            })
            .default({}),
          saml: z
            .strictObject({
              metadata: text.optional().describe("A file with the provider's metadata XML."),
              sp_key: text
                .optional()
                .describe('Files with our key and certificate (PEM), for providers that want signed requests.'),
              sp_cert: text.optional(),
            })
            .default({}),
        })
        .default({ mode: 'off', name: 'single sign-on', domains: [], auto_create: 'on', oidc: {}, saml: {} }),
    })
    .default({
      personal_tokens: 'admins',
      sso: { mode: 'off', name: 'single sign-on', domains: [], auto_create: 'on', oidc: {}, saml: {} },
    }),

  mcp: z
    .strictObject({
      client_hosts: list
        .default([])
        .describe("The only hosts MCP clients' metadata documents may be on, like claude.ai; any unless set."),
    })
    .default({ client_hosts: [] }),

  email: z
    .strictObject({
      mode: choice(['log', 'sendmail'])
        .optional()
        .describe(
          "sendmail: through this machine's sendmail; log: sign-in codes in the server's log. SMTP when smtp_url is set.",
        ),
      smtp_url: text
        .optional()
        .describe(
          'smtps://user:password@host:465 or smtp://user:password@host:587: a secret, as it holds the password.',
        ),
      sendmail: text.default('/usr/sbin/sendmail').describe("The sendmail command's full path."),
      from: text.optional().describe('The sender of sign-in codes: "Ideation Factory <sign-in@example.com>".'),
      notify_from: text.optional().describe("The sender of notifications (from's unless set)."),
      notifications: onOff.default('on').describe('off: no notification emails (sign-in codes still go).'),
    })
    .default({ sendmail: '/usr/sbin/sendmail', notifications: 'on' }),

  files: z
    .strictObject({
      /** A bucket for ideas' files; without one they go in a folder under data, which suits one machine. */
      s3: z
        .strictObject({
          bucket: text,
          endpoint: text.optional().describe("The store's URL, for anything but AWS (http://seaweedfs:8333)."),
          region: text.default('us-east-1'),
          access_key_id: text
            .optional()
            .describe("Its key, allowed only this bucket; without them, Bun's S3_* or AWS_* variables."),
          secret_access_key: text.optional().describe('A secret.'),
          prefix: z.string().default('files/').describe('Where files go in it.'),
          virtual_hosted: onOff
            .default('off')
            .describe('The bucket in the hostname, as AWS prefers; in the path when off.'),
        })
        .optional(),
    })
    .default({}),

  /** The Markdown size limits, in bytes, and what a live draft takes on (limits.ts). */
  limits: z
    .strictObject({
      max_file_bytes: whole(LIMIT_RANGES.maxFileBytes.min, LIMIT_RANGES.maxFileBytes.max)
        .default(DEFAULT_LIMITS.maxFileBytes)
        .describe('The largest file, in bytes'),
      max_idea_bytes: whole(LIMIT_RANGES.maxIdeaBytes.min, LIMIT_RANGES.maxIdeaBytes.max)
        .default(DEFAULT_LIMITS.maxIdeaBytes)
        .describe('The largest idea, all its files together, in bytes'),
      draft: z
        .strictObject({
          editors: whole(LIMIT_RANGES.draft.editors.min, LIMIT_RANGES.draft.editors.max)
            .default(DEFAULT_DRAFT_LIMITS.editors)
            .describe(
              'The most windows editing one draft at once; past it, a window opens the draft read-only, still live. ' +
                'Every keystroke and caret move goes to everyone in the draft, so the work grows with the square of this: ' +
                'measure it on your hardware with the draft crowd load test (packages/load).',
            ),
          caret_ms: whole(LIMIT_RANGES.draft.caretMs.min, LIMIT_RANGES.draft.caretMs.max)
            .default(DEFAULT_DRAFT_LIMITS.caretMs)
            .describe('How often, at most, a window sends where its caret is, in milliseconds'),
          keep_steps: whole(LIMIT_RANGES.draft.keepSteps.min, LIMIT_RANGES.draft.keepSteps.max)
            .default(DEFAULT_DRAFT_LIMITS.keepSteps)
            .describe(
              'How many of a file’s typing steps are kept for a window catching up after a dropped connection, at least ' +
                '(this many, or keep_minutes, whichever keeps more). Further behind, the window saves its page block by block.',
            ),
          keep_minutes: whole(LIMIT_RANGES.draft.keepMinutes.min, LIMIT_RANGES.draft.keepMinutes.max)
            .default(DEFAULT_DRAFT_LIMITS.keepMinutes)
            .describe('How long a file’s typing steps are kept for catching up, in minutes'),
          snapshot_every: whole(LIMIT_RANGES.draft.snapshotEvery.min, LIMIT_RANGES.draft.snapshotEvery.max)
            .default(DEFAULT_DRAFT_LIMITS.snapshotEvery)
            .describe(
              'How often a file’s document is stored whole, in steps: an idea waking up replays at most this many',
            ),
          restore_quiet_minutes: whole(
            LIMIT_RANGES.draft.restoreQuietMinutes.min,
            LIMIT_RANGES.draft.restoreQuietMinutes.max,
          )
            .default(DEFAULT_DRAFT_LIMITS.restoreQuietMinutes)
            .describe(
              'How long the draft is quiet before a restore point is kept, in minutes (one is also kept before a discard)',
            ),
          restore_every_minutes: whole(
            LIMIT_RANGES.draft.restoreEveryMinutes.min,
            LIMIT_RANGES.draft.restoreEveryMinutes.max,
          )
            .default(DEFAULT_DRAFT_LIMITS.restoreEveryMinutes)
            .describe('How often a restore point is kept while the draft is busy, at most, in minutes'),
        })
        .default({
          editors: DEFAULT_DRAFT_LIMITS.editors,
          caret_ms: DEFAULT_DRAFT_LIMITS.caretMs,
          keep_steps: DEFAULT_DRAFT_LIMITS.keepSteps,
          keep_minutes: DEFAULT_DRAFT_LIMITS.keepMinutes,
          snapshot_every: DEFAULT_DRAFT_LIMITS.snapshotEvery,
          restore_quiet_minutes: DEFAULT_DRAFT_LIMITS.restoreQuietMinutes,
          restore_every_minutes: DEFAULT_DRAFT_LIMITS.restoreEveryMinutes,
        }),
    })
    .default({
      max_file_bytes: DEFAULT_LIMITS.maxFileBytes,
      max_idea_bytes: DEFAULT_LIMITS.maxIdeaBytes,
      draft: {
        editors: DEFAULT_DRAFT_LIMITS.editors,
        caret_ms: DEFAULT_DRAFT_LIMITS.caretMs,
        keep_steps: DEFAULT_DRAFT_LIMITS.keepSteps,
        keep_minutes: DEFAULT_DRAFT_LIMITS.keepMinutes,
        snapshot_every: DEFAULT_DRAFT_LIMITS.snapshotEvery,
        restore_quiet_minutes: DEFAULT_DRAFT_LIMITS.restoreQuietMinutes,
        restore_every_minutes: DEFAULT_DRAFT_LIMITS.restoreEveryMinutes,
      },
    }),

  web: z
    .strictObject({
      dir: text.optional().describe("The built web app (the web package's dist unless set)."),
      dev_url: text.optional().describe("Vite's dev server, while working on the web app (bun run dev sets it)."),
    })
    .default({}),
})

export type Settings = z.infer<typeof settingsSchema>

/**
 * The secrets: kept out of ideaf.yaml (a warning if one turns up there), in secrets.yaml, the
 * environment, or a file named by the key with _file added (auth.secret_file), as Docker and
 * Kubernetes hand them out.
 */
export const SECRETS = [
  'auth.secret',
  'auth.scim_token',
  'auth.sso.oidc.client_secret',
  'engine.token',
  'email.smtp_url',
  'files.s3.secret_access_key',
] as const

/** A key's environment variable: files.s3.bucket is IDEAF__FILES__S3__BUCKET. */
export const envName = (path: string) => `IDEAF__${path.replaceAll('.', '__').toUpperCase()}`
