# Report 1: the first deployment benchmark

Two sessions on 14 November 2026, on the Frankfurt deployment ([DEPLOYMENT.md](../../DEPLOYMENT.md)): three `m7i.xlarge` nodes, S3 in the same region, the design-scale seed (10,000 people, 100,000 ideas), the app at `e6f8638`, RivetKit and the engine 3.1.1.

- [Session 1](session1/): the three-node tier, on RivetKit with the fix for rivet-dev/rivet#5991 and as published; reading files from S3; the buckets at rest and under load.
- [Session 2](session2/): the engines' floor at rest, measured cleanly; the directory on machines of its own; fail-over.

## In short

| What                                                   | Result                                                                                        |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Three nodes, the directory on them                     | about **120 page views a second** (130 at the edge), limited by the directory's single thread |
| The same on RivetKit as published                      | a step less (120 at a p95 of 272 ms), and much less under sustained writes                    |
| The directory on two `c8a.xlarge` of its own           | about **140** (150 at the edge), limited by its commits' round trips, not CPU                 |
| Reading a file from S3                                 | p50 26 ms, p95 50 to 57 ms: about a quarter of an idea page                                   |
| The engines at rest                                    | about 82,000 GETs, 4,600 PUTs and 1,800 LISTs an hour: about $45 to $50 a month on Azure Blob |
| An app stopped gracefully                              | no failures                                                                                   |
| The directory's process stopped gracefully, under load | **4 min 34 s** of failures                                                                    |
| An app killed, under load                              | 9 s, then 1 min 48 s when its actors restart together                                         |
| Every idea after each session                          | all 100,000 opened                                                                            |

At the design scale's page a minute per person, 120 page views a second is about 7,200 people all active at once.

## What follows

- **For 1.0:** the app sheds load while the directory is slow, and the directory is warm before it takes over; then fail-over again, with a whole node lost.
- **The deferred-commits experiment** (RivetKit 3.1.2) on the directory machines, where commit round trips are now the limit.
- The engines' floor at rest with one engine, to tell whether the data's reads grow with engines or with data.
