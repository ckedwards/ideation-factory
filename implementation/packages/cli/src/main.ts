#!/usr/bin/env bun
// ideaf: the Ideation Factory cli. Commands are a small hand-rolled table that
// drives parsing and --help. Prompts (@clack/core) only appear when a person is
// at a terminal; agents get --json and clear errors. Step 4 of the build plan
// adds start, sync, show --blocks, edit and pull.

type Command = { name: string; summary: string; run: (args: string[]) => Promise<number> }

const commands: Command[] = [
  {
    name: 'version',
    summary: 'Print the version',
    run: async () => {
      console.log('ideaf 0.0.0')
      return 0
    },
  },
]

function help() {
  console.log('Usage: ideaf <command> [options]\n')
  for (const c of commands) console.log(`  ${c.name.padEnd(12)}${c.summary}`)
}

export async function main(argv: string[]): Promise<number> {
  const [name, ...rest] = argv
  if (!name || name === '--help' || name === 'help') {
    help()
    return 0
  }
  const command = commands.find((c) => c.name === name)
  if (!command) {
    console.error(`ideaf: unknown command "${name}". Run "ideaf --help".`)
    return 2
  }
  return command.run(rest)
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)))
