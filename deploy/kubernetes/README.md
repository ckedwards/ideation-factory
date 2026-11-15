# Ideation Factory on Kubernetes

Later: not needed for 1.0, and nothing here to run yet. The plan, and what it needs to show first, is the [Kubernetes spike](../../docs/k8s-spike.md).

What's already known, for whoever gets to it:

- **The engine** as Rivet documents it (rivet.dev/docs/deploy): a StatefulSet of three or more, one per Kubernetes node (required anti-affinity), each on a block-storage volume of its own (100 GiB, never a network file system), a headless Service for the engines' port 6421 (never exposed: it's plaintext and unauthenticated), and 660 s between SIGTERM and SIGKILL. Our build of it, as on VMs ([Deploying](../README.md#our-builds)).
- **The app and the directory** as Deployments of our build, with 60 s between SIGTERM and SIGKILL, readiness on `/health` (it fails while the process is cut off from the engine), and the same `RIVET_NODE_VERSION` in every pod.
- **What the Compose deployments taught,** which carries over: the engine's open-file limit (a pod spec can't set one, so the engine's start has to raise its own), keeping the engines and the directory from being evicted or killed for memory, and the costs of each kind of stop ([Losing a machine](../README.md#losing-a-machine-today)).
