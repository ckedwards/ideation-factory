# The draft editor limit

`limits.draft.editors` stays at 20 (decided 2026-11-25). Twenty people typing in one idea's draft at once covers how drafts are used. Raising it waits for a Rivet fix that isn't released yet, and then for the measurements below.

## What the limit does

It's the most windows that can edit one idea's draft at once. A window past it opens the draft read-only, still live, and can type once someone leaves. It's a setting (`limits.draft.editors` in `ideaf.yaml`, or `IDEAF__LIMITS__DRAFT__EDITORS`), from 1 to 1,000, so a deployment can set what its hardware takes (`packages/server/src/limits.ts`).

There's a limit because every draft is one actor. Every keystroke and caret goes through it to every window in the draft, so the work grows with the square of the windows. The draft crowd load test (`packages/load/src/draft-crowd.ts`, method in `packages/load/README.md`) measures it.

## What was measured

Every window typing 3 keystrokes a second, each crowd in a new idea, two runs at each size (60 s on AWS, 30 s on the laptop); each cell is the range over the two runs, and every run read back all its typing. The app is the build with the behind fast path (#188). The laptop rows are from `packages/load/README.md` (2026-11-24, one node in Docker); the AWS rows are the Frankfurt deployment (`packages/load/DEPLOYMENT.md`: three m7i.xlarge nodes of 4 vCPU, gp3 disks, S3), 2026-11-25.

| Windows | Where | Engine | Stored, p95 | p99 | Max | Behind |
| --- | --- | --- | --- | --- | --- | --- |
| 10 | AWS | 3.1.1 | 12 ms | 462–536 ms | 1.06–1.09 s | 18–19% |
| 10 | AWS | 3.1.1 + fix | 13–14 ms | 18–19 ms | 31–34 ms | 19% |
| 20 | Laptop | 3.1.1 | 10–14 ms | 16–820 ms | | 26–32% |
| 20 | AWS | 3.1.1 | 17–19 ms | 502–549 ms | 1.05–1.15 s | 35–37% |
| 20 | AWS | 3.1.1 + fix | 16–17 ms | 24 ms | 43–49 ms | 34–35% |
| 40 | Laptop | 3.1.1 | 30 ms–2.3 s | 0.9–4.7 s | | 54–90% |
| 40 | AWS | 3.1.1 | 42–56 ms | 574–613 ms | 1.27–1.32 s | 63–67% |
| 40 | AWS | 3.1.1 + fix | 46–49 ms | 83–86 ms | 184–239 ms | 67% |

"The fix" is Rivet's engine built with the change in rivet-dev/rivet#5963. On the AWS nodes, 40 windows hold with it. Without it, every run had a pause of about a second, which is the p99 and max of every AWS row on 3.1.1. The laptop fails at 40 with or without that pause: it's slower there for other reasons, as the p95 shows.

## What limits one draft

1. **A Rivet bug: a one-second pause in every new idea.** At its database's 1,025th commit, Rivet's depot client refuses a write twice, 500 ms apart, because it never learned that the engine had applied the earlier ones. It happens once per idea, whatever the crowd's size. It's reported as [rivet-dev/rivet#6031](https://github.com/rivet-dev/rivet/issues/6031), with the cause and a minimal repro in [rivet-backlog-stall-repro](https://github.com/ckedwards/rivet-backlog-stall-repro); [rivet-dev/rivet#5963](https://github.com/rivet-dev/rivet/pull/5963) fixes it and is open, unreviewed. It's on 3.1.1 and on Rivet's `main` (3.1.2-rc.7).
2. **The behind loop: the p95.** A send that arrives after someone else's typing has landed is answered "behind": the window receives those steps, rebases and sends again. At 40 windows two thirds of sends are behind, so a keystroke takes about three sends, and the p95 goes from 16 ms at 20 windows to about 48 ms. The odds of being behind grow with the windows, the typing rate and the round trip together.
3. **Sending everything to everyone: the ceiling.** From 20 to 40 windows, the idea's app process went from about 22% to 55% of a core, and its engine from about 18% to 43%. The actor runs on one JS thread, so on that trend it reaches a full core at about 55 to 60 windows. That's an estimate: nothing past 40 was run on AWS.

What isn't a limit yet: a commit costs about 1.3 ms (a disk sync of about 1 ms on gp3, on all three engines), which keeps the actor's write queue busy for less than a fifth of the time at 40 windows; and carets reach everyone in 3 to 4 ms at 40 windows, so delivery keeps up.

All of this is one draft on one actor. Other ideas run on other actors and cores, so a deployment's capacity doesn't depend on it. The crowd is the worst case: everyone typing nonstop. Real typing comes in bursts, with far fewer sends behind.

## Why 20 for now

- Twenty people typing in one draft at once covers most use.
- Forty only holds on the AWS nodes with the Rivet fix, which isn't in a release.
- The default should fit a modest machine, and the laptop fails at 40. A deployment on bigger hardware can raise the setting after running the crowd test there.

## Once the Rivet fix is released

In this order, each step deciding whether the next is worth it:

1. **Upgrade and measure.** Move to the RivetKit and engine release with the fix (#5963, or Rivet's own), then run the crowd on the Frankfurt deployment at 20, 40, 50, 60 and 80 windows, with a CPU profile of the idea's process. That decides whether the default can go to 40, finds where typing gives out, and shows what the CPU goes on.
2. **Batch what goes out.** Send each window one frame per tick (every 30 to 50 ms) holding every step and caret since the last, instead of an event for each. At 60 windows that's about 1,200 to 2,000 frames a second instead of about 22,000 events, for the app and the engine alike. It costs up to a tick of delay before others see your typing, and changes the draft's live protocol (`draft-live.ts`, the editor's collab).
3. **Rebase behind sends on the server.** The actor maps a behind send's steps over the newer ones and stores them, instead of answering "behind". That removes most retries and the round trips that make the p95. It's a bigger change: concurrent edits must still merge exactly as they do now, and the actor does the rebasing.
4. **Rust, only if it's still the JS thread.** RivetKit has a Rust actor SDK, with far less overhead per message. But the actor applies and checks steps with ProseMirror, which is JavaScript, so the step logic would need a port. Only worth it if a profile after 2 and 3 still shows the JS side at a full core.

## Where things are

- The limit and its default: `packages/server/src/limits.ts`.
- The crowd test and the laptop results: `packages/load/src/draft-crowd.ts`, `packages/load/README.md` (A crowd in one draft).
- The deployment: `packages/load/DEPLOYMENT.md`.
- The Rivet bug: [rivet-dev/rivet#6031](https://github.com/rivet-dev/rivet/issues/6031) (the issue), [rivet-backlog-stall-repro](https://github.com/ckedwards/rivet-backlog-stall-repro) (the repro), [rivet-dev/rivet#5963](https://github.com/rivet-dev/rivet/pull/5963) (the fix).
