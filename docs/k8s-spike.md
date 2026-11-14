# Spike: Kubernetes

**Status:** planned, after 1.0: not needed for the MVP, which runs on Docker Compose. The MVP's docs mention a Kubernetes example ([MVP architecture](mvp/architecture.md)) and a Helm chart later ([backend](mvp/architecture-backend.md)); neither exists. This spike designs the layout, tries it, and measures what ordinary Kubernetes events cost. The answer goes into `deploy/` (the example, later the chart), the [deploy guide](../deploy/README.md) and the [sizing guide](admin/performance.md).

## The question

How should Ideation Factory run on Kubernetes so that the things Kubernetes does every day (rollouts, drains, evictions, out-of-memory kills, a node going away) cost as little as possible, and one misbehaving actor or process harms as little as possible?

## Why we're asking

What a stop costs depends on whether the process gets to say goodbye, and Kubernetes knowing a container is dead doesn't tell Rivet. From the Compose deployments and Rivet 3.1.1's code:

| What happens | Signal | Cost |
|---|---|---|
| A rollout, scale-down, drain, `kubectl delete`, preemption, soft eviction | SIGTERM, then the grace period | **about 0.3 s**: the app hands its actors over (given at least 60 s before SIGKILL, as Rivet asks) |
| A liveness probe fails | SIGTERM first | fast if the process can still act on it; if it's stuck, SIGKILL after the grace period, then 40 s |
| **Out of memory** (the container's limit) | SIGKILL from the kernel | **40 s** for every actor in that process |
| Hard eviction, `--force --grace-period=0` | SIGKILL | **40 s** |
| A node dies, its engine with it | nothing | **100 to 136 s** on 3.1.1, in 5 of 5 tests |

**The 40 s** is Rivet's `pegboard.node_lost_threshold`: "how long a disconnected node keeps its actors before stopping them… the engine waits as long after a connection closes before it judges the node's actors lost, so both sides agree. It must exceed the node client's longest reconnect backoff (30 s), or an engine restart stops every actor." It's there so an app survives its engine restarting, and the engine can't tell that from the app dying. Lowering it gains at most 9 s.

**An engine is noticed dead after 31 to 33 s:** each renews a lease in the bucket every 3 s, and the others judge it dead 30 s after its last renewal (`topology/src/config.rs`), sized so that an object store's stalls of about 10 s never make two engines own the same storage.

**Engines die in more ways than apps, and it's worse:** they hold the cluster's storage. One stops itself on purpose when its local disk can't be written ("state machine requested fail-stop"), as on the Frankfurt deployment when it ran out of open files, and would when its disk fills up; or out of memory (2 to 3 GB during the seed there); or if it can't reach the bucket long enough to keep its lease. Both bursts of damaged ideas on the Frankfurt deployment came straight after engine restarts under load.

**One bad actor can harm far more than itself.** RivetKit runs many actors in one process, on one JavaScript thread: a loop that never yields stalls all of them, a memory leak has all of them killed, and a crash in the native module takes all of them. Storage is shared through the engines' quorum: one overloaded node on the Frankfurt deployment left all three engines reporting `QuorumUnavailable`. Rivet caps a transaction (128 MiB) and what queues behind one (128 operations), not how much one actor writes over time.

## What's already known

- **The Compose layout** (`deploy/three-vms/node.yaml`) puts an app, a directory process and an engine on each machine; the app and the directory talk to the engine beside them. Nothing requires that: any app can use any engine.
- **Every app process must report the same node version** (`RIVET_NODE_VERSION`), or the engine gives every actor to the highest. The published image carries the commit's time, the same for every pod running it.
- **The health check** (`/health`) passes only while the process is connected to its engine; a new engine waits about a minute before it serves.
- **SIGTERM needs 60 s** before SIGKILL (`terminationGracePeriodSeconds: 60`).
- **The directory** keeps its whole database in memory, up to 256 MB, in one process at a time; standby directory processes take over after the 40 s if its process dies, and the whole site waits meanwhile.
- **An engine's open-file limit can't be set in a pod spec** (Kubernetes has no `ulimits`), and Docker on Ubuntu gives containers a soft limit of 1024, which an engine outgrows. A process may raise its own soft limit up to the hard one: in the engine's image, `ulimit -n "$(ulimit -Hn)"` took it from 65,536 to 524,288. An entrypoint doing that before starting the engine would work anywhere, if nodes' hard limits are high.
- **Engines' storage records engines by address** (which is why a restore needs the same addresses), and each engine advertises one to its peers (`RIVET__API_PEER__ADVERTISE_ADDRESS`).
- **An engine's write-ahead log belongs on a local disk,** not a network one (`node.yaml`).

## The design to test

**Engines: a StatefulSet** of three, one per node and spread across zones (anti-affinity, topology spread), each on its own volume, with a headless Service so each has a stable name to advertise. Guaranteed QoS (requests equal to limits), so they're the last pods evicted and the kernel's out-of-memory killer prefers others; a high PriorityClass, so nothing preempts them; a PodDisruptionBudget of one, so a drain never takes two of three; the entrypoint raising the open-file limit.

**Apps: a Deployment of many small pods** rather than three big ones. Actors are spread by hashing over every live app process, so a pod that dies stalls only its share: a third with three pods, a twelfth with twelve. The 40 s still applies, to fewer actors. `terminationGracePeriodSeconds: 60`; readiness on `/health`; a liveness probe that only fails when the process really is stuck, with generous thresholds; spread across nodes.

**The directory: a Deployment of its own,** in the directory pool, three replicas (one active, two standing by) on different nodes, Guaranteed QoS with room above its database, high priority, a PodDisruptionBudget of one. A misbehaving idea can't take it down, as ideas run in other pods.

**A memory watchdog in the app:** it reads its container's limit (`/sys/fs/cgroup/memory.max`), and past about 90% of it starts its own graceful stop, the SIGTERM path, so the kernel never kills it. The likeliest Kubernetes kill becomes a hand-over of a fraction of a second; Kubernetes restarts the pod.

**Nodes going away gracefully:** Kubernetes' graceful node shutdown, so a node rebooting for patches sends SIGTERM to its pods first; on spot or preemptible nodes, a termination handler that drains on the cloud's notice. Only real hardware failures then pay the full time.

**The bucket:** the cloud's, with each key from a Secret, or the cluster's workload identity where the engine and the app can use one.

**In front:** an Ingress or Gateway for TLS, sending requests to any ready app pod.

**Isolation by pool:** any future kind of heavy work (imports, exports for backups) in a pool and pods of its own, as the directory is, so it can't stall the actors people are using.

## What it needs to show

1. Every planned event (a rollout, scaling down, a drain, a node shutting down, a preemption) costs no failed requests, and actors move in under a second.
2. An app pod killed for memory: with the watchdog, no 40 s; without it, only that pod's share of actors waits.
3. An engine pod lost, gracefully and not: how long until everything answers; whether the apps connected to it reconnect to another engine within the 40 s and keep their actors; no damaged ideas afterwards (every idea opened).
4. An engine replaced with an empty volume (its node gone for good) rejoins, and the cluster carries on, with no restore.
5. The open-file limit holds on managed clusters' nodes.
6. One misbehaving actor (a loop that never yields, a memory leak, a flood of writes) harms only its own pod, or its own pool's.

## Experiments

On k3s across the Frankfurt deployment's machines first (`packages/load/DEPLOYMENT.md`), with its seed and its load test, as it costs nothing more than the machines; then once on a managed cluster (EKS in eu-central-1: about $0.10 an hour for the control plane) for what differs there (node images and their limits, workload identity, graceful node shutdown, volumes).

- **Planned events:** `kubectl rollout restart`, scaling down, `kubectl drain`, a node shut down cleanly, each during a steady run: failed requests, and how long actors waited.
- **Kills:** an app pod killed with SIGKILL (as for out-of-memory), with and without the watchdog, and with 3 and 12 app pods; a directory pod the same way. Whether the engine's per-actor reschedule (`POST /actors/<id>/reschedule`) can safely move the directory at once when its pod is known dead, which a small controller could do.
- **Engines:** a graceful restart and a SIGKILL during a steady run; which engine the apps reconnect to, through the headless Service or a Service in front of all engines; an engine's volume filled up on purpose; an engine replaced with an empty volume; every idea opened afterwards.
- **Where the engines' logs go:** a local volume against a network one in the same zone, for write latency and for what happens when the node goes (a local volume can't follow its pod to another node).
- **Limits:** the open-file limit inside a pod on k3s and on EKS, with and without the entrypoint.
- **A bad actor:** a test-only actor that spins, one that leaks memory, one that writes as fast as it can, each beside the load test: what else slows down, in its pod, its pool and the cluster.

## Deciding

- **Engines' storage:** local volumes (fast, but tied to their node) or network ones (they follow the pod, but slower); and whether an engine lost with its node is replaced empty.
- **Which engine an app talks to:** the one on its node, any through a Service, or engines as a DaemonSet with node-local traffic.
- **The memory watchdog and a directory controller:** whether each earns its place, by what they save.
- **How it's packaged:** plain manifests as the example, Kustomize, or a Helm chart; and what of it is a default and what a choice for the operator.

## Risks

- **Engines and addresses:** if an engine's identity is tied to its address, a StatefulSet pod rescheduled elsewhere, or a replaced engine, may confuse the cluster's storage; this is the experiment most likely to change the design.
- **Rivet's open bugs** apply here as anywhere: actors stuck after a node's loss (rivet-dev/rivet#5957, seen on 3.0.6) and damaged databases after engine restarts under load (Frankfurt, not reported). Kubernetes restarts things more often than VMs do, so it may meet them more.
- **Managed clusters differ:** node images, their limits, and what workload identity the engine's and the app's S3 clients accept.
- **Many small app pods** cost memory per pod (about 100 MB idle), and more connections to the engines.

## Time limit

A week. If engines can't be made to survive being rescheduled in that time, the example runs them pinned to nodes, as the Compose deployment does, and the rest of the layout stands.

## Findings

None yet.
