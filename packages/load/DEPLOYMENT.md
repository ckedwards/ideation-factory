# The load test on a deployment

The three-VM deployment (`deploy/three-vms`) on machines with CPUs of their own (not burstable), its buckets in S3, driven from a machine of its own by `remote.sh`. It checks what one laptop couldn't measure steadily: the sizing tiers, fail-over, how much of an idea page goes on reading files from S3, and RivetKit 3.1.2's deferred commits. Benchmarks belong here, or on another machine of their own: a laptop's CPU throttles on battery and when hot, and a day of runs on one drifted more than the changes it measured.

Two setups on AWS, the same layout and steps:

- **Frankfurt, for everyday benchmarks:** EC2 and S3 in eu-central-1, in one zone. About $1 an hour, so runs can be repeated freely.
- **The US, for checking production:** EC2 and S3 in us-east-1, where customers are likely to deploy, the nodes in three zones as a production deployment would be. For occasional checks, such as before a release.

Run either only while measuring: stop or snapshot between sessions, and tear it all down at the end. [Hetzner](#hetzner), below, costs about the same with the buckets still in S3, once its account allows enough dedicated CPUs; **Azure** isn't ready yet ([Azure](#azure)).

## The machines

| Machine                                        | Count | AWS                          | Why                                                                    |
| ---------------------------------------------- | ----- | ---------------------------- | ---------------------------------------------------------------------- |
| Node: app, directory node, engine              | 3     | `m7i.xlarge` (4 vCPU, 16 GB) | Three for fail-over, not capacity; the engine used about 5 GB at scale |
| Load balancer: Caddy                           | 1     | `c7i.large` (2 vCPU)         | TLS and round-robin                                                    |
| Load: k6, the seeder, Mailpit                  | 1     | `c7i.xlarge` (4 vCPU)        | k6 at 500 requests a second uses a few cores; kept off the nodes       |
| Directory machines (the dedicated tier, later) | 2     | `m7i.xlarge`                 | Only for that part: the directory nodes move here                      |

**Four vCPUs a node,** a size a customer would buy: at the laptop's peak (about 500 requests a second), the directory took about one core and the engine about three, across all three nodes. Go to eight (`m7i.2xlarge`) only if a node's CPU is the limit before the directory is.

**Non-burstable CPUs only:** not `t3` or `t4g`, which slow down under a long test, and the numbers with them.

**The quota:** a new account may run only 5 vCPUs of these in a region. Ask for 32 first, in Service Quotas: Amazon EC2, "Running On-Demand Standard (A, C, D, H, I, M, R, T, Z) instances", in the region used. The layout uses 18, and 26 with the directory machines.

**Frankfurt:**

- **Location:** eu-central-1, every machine in one zone (eu-central-1a), so nothing pays for traffic between zones.
- **Network:** a VPC (`10.0.0.0/16`) with one subnet (`10.0.0.0/24`). Each machine has a public address for SSH and for reaching GitHub and image registries, and an S3 gateway endpoint keeps the buckets' traffic inside AWS.
- **Disks:** gp3, 100 GB on each node for the engine's write-ahead log and cache, 30 GB on the others.

**The US:** the same in us-east-1, with a subnet in each of three zones and a node in each; the load balancer and load machine in one of them. The quota is per region, so ask for it there too.

**Both:**

- **Buckets:** one for the engine, one for files. Block public access; no versioning, as the engine rewrites its own objects.
- **Keys:** an IAM user and access key for each bucket (the app's S3 client can't use an instance role), allowed only its own bucket:
  - the engine's: `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject`, `s3:AbortMultipartUpload` on `arn:aws:s3:::<engine bucket>/*`, and `s3:ListBucket` on `arn:aws:s3:::<engine bucket>`;
  - the files': `s3:GetObject` and `s3:PutObject` on `arn:aws:s3:::<files bucket>/*`, nothing else.

  If the engine is refused something it needs, its log says so: note it, so `deploy/README.md` can be corrected.

- **Security groups,** with SSH from your address only, and between the machines:
  - nodes: 8080 from the load balancer and the load machine; 6421 between the nodes; 22 from the load machine;
  - load balancer: 443 from the load machine;
  - load machine: 1025 (Mailpit's SMTP) from the nodes.

## Setting it up

1. **Every machine:** Docker with Compose. The load machine also needs Bun, git, and SSH keys to the nodes (for `docker stats`). Give each machine a fixed private address: the seed's snapshots (below) depend on them staying the same.
2. **The nodes:** clone the repository at the commit being measured, and fill in `deploy/three-vms/.env` from its example:
   - `NODE_ADDRESS`: each node's own private address;
   - `LB_ADDRESSES`: the load balancer's private address **and the load machine's**, so the app believes the addresses k6 sends for each person (otherwise every person is one address, and sign-in's rate limits throttle the seeder);
   - `S3_ENDPOINT`, `S3_REGION`, the buckets, and the two keys;
   - `IDEAF_SMTP_URL=smtp://<load machine's private address>:1025`, so sign-in codes reach Mailpit;
   - `TLS_MODE=internal` (no DNS needed; set `LOAD_INSECURE_TLS=1` on the load machine), or a real name with `acme`.

   Then `docker compose -f node.yaml up -d --build` on each, and wait until the app and directory show healthy.

3. **The load balancer:** the same `.env`, with `APP_NODES` (the three nodes' `<address>:8080`) and `LB_TRUSTED_PROXIES=<load machine's private address>/32`, so Caddy passes on k6's X-Forwarded-For. Then `docker compose -f lb.yaml up -d`.
4. **The load machine:** clone the repository, `bun install`, then copy `packages/load/remote.env.example` to `packages/load/.data/remote.env` and fill it in. With `TLS_MODE=internal` the deployment's name has no DNS: add it to `/etc/hosts` with the load balancer's private address, for the seeder, and set `LOAD_LB_ADDRESS` to the same address, for k6 (its container doesn't see `/etc/hosts`). Then:

   ```sh
   cd packages/load
   ./remote.sh up        # Mailpit
   ./remote.sh seed      # the design scale: hours, once (see below); resumable if interrupted
   LOAD_RATE=100 LOAD_DURATION=5m ./remote.sh steady
   ```

The deployment runs the published RivetKit, which has rivet-dev/rivet#5991, with its workaround (`IDEAF_DIRECTORY_CALLS=4`), as people will run it.

## The seed: once, then restored

Seeding the design scale takes hours, but it's done once per deployment. The data lives in the engines' disks and the buckets, and stays through:

- the app's code, settings and images, and RivetKit upgrades that the engine migrates (3.0.6's data went to 3.1.1 as it was);
- moving the directory nodes (the tiers), the load balancer's settings, and anything on the load machine.

It has to be seeded again when:

- the directory's or an idea's schema changes (no migrations during the alpha);
- the engines change: their number, or their addresses.

It can't be made on another machine and copied in: the engine's storage records which engines hold what, at which addresses, so one setup's data doesn't fit another's.

**To go back to the freshly seeded state** after runs have added comments, versions and notifications, keep a copy of it once:

1. Stop the three nodes' containers (`docker compose -f node.yaml stop`), so nothing is mid-write.
2. Snapshot the three nodes' disks (EBS snapshots).
3. Copy both buckets within S3: `aws s3 sync s3://<bucket> s3://<bucket>-seed`. Within a region that's requests only, no transfer.

To restore it: stop the nodes, restore their disks from the snapshots with the same private addresses, sync both buckets back (`aws s3 sync s3://<bucket>-seed s3://<bucket> --delete`), and start them. Minutes, not hours. Rivet hasn't yet validated restoring a cluster's storage for this release, so try a restore once, and check that the data answers, before relying on it.

## What to measure

- **The tiers:** the page-view rate each layout holds with under 1% failures and a p95 under a second, stepping up in 90 s steps after a warm-up:
  - three nodes;
  - three nodes, with the directory's nodes on two machines of their own (move the `directory` services there).
- **Reading files:** each app node logs a summary of its file store once a minute (`file store, the last 60 s: … reads, p50 …, p95 …, … ms in all`). Compare the reads' time with the time spent on idea pages (`op_open_idea` and `op_list_comments` in k6's results) to see how much of a page goes on S3.
- **Fail-over:** a node stopped with SIGTERM, a node's app killed, and a whole node (app, directory node and engine) killed, each while a steady run goes on. Note when everything answers again.
- **Deferred commits** (RivetKit 3.1.2-rc.1 or later, the directory only, behind a setting that's off by default): the same steps, with them on and off.

## Costs

Roughly, at on-demand prices in US dollars, from AWS's price list in November 2026 (check the calculator; they change):

|                                        | Frankfurt                             | The US (us-east-1)                                   |
| -------------------------------------- | ------------------------------------- | ---------------------------------------------------- |
| The five machines, running             | about $1.03 an hour                   | about $0.87 an hour                                  |
| The two directory machines, while used | about $0.48 an hour                   | about $0.40 an hour                                  |
| Public addresses                       | $0.005 an hour each, while running    | the same                                             |
| Disks while stopped                    | about $1 a day for the EBS volumes    | the same                                             |
| Data between the nodes and S3          | none: the gateway endpoint, in-region | none                                                 |
| Data between zones                     | none: one zone                        | about $0.01 per GB each way: a few dollars a session |
| S3 storage and requests                | a few dollars                         | a few dollars                                        |

A first session (setup, the seed, first measurements) is about $10–15. Later sessions, starting from the seed's snapshots, cost their hours of measuring. Set a budget alert on the account before starting.

## Hetzner

Dedicated-CPU servers (CCX23 nodes and load machine, a CCX13 load balancer: about $0.73 an hour together, billed in dollars to a US account) in Nuremberg or Falkenstein, on a private network in the `eu-central` zone, with the buckets in S3 in Frankfurt, a few milliseconds away. Hetzner's own object storage doesn't have the conditional writes the engine needs. It costs a little less by the hour than AWS, but reading from S3 is charged as egress (about $0.09 per GB: the engine's cold reads and compaction, a few dollars a session), and its firewall doesn't filter the private network.

A new Hetzner account is limited to 10 dedicated vCPUs, and can't ask for more until it's older, so the layout's 18 won't fit one at first. Only the dedicated CCX servers will do, not the shared CX or CPX.

## Azure

Azure costs about what AWS does for the same layout (`D4s_v5` nodes, about $0.19 an hour each), so it adds nothing for everyday benchmarks. Its use is as a check of an Azure deployment before one goes live: the engine's storage on Blob Storage (which the engine supports natively, and which Rivet runs its own load tests on), storage reached with Entra ID instead of keys, and the network a company's tenant puts around it.

It waits on the app: its file store speaks only S3 so far, and Blob Storage has no S3 API. A run before that would either keep the files in S3, across clouds, which no Azure deployment would do, or test only half the stack. Once the app has an Azure file store, the session follows the steps above with:

- `Dsv5` or `Dasv5` machines (not the burstable B series), the nodes in three zones of one region;
- the engine's configuration using `azure:` (an account, a container, and a key or the machines' managed identity) instead of `s3:`;
- the app's files in a second container, with a key or identity allowed only that container.

## Afterwards

Between sessions, stop the instances (their disks keep the data, at about $1 a day), or for a long break snapshot the nodes' disks and terminate the instances. At the end, delete everything: the instances, their disks and snapshots, the VPC, both buckets and their seed copies, and the two IAM users and their keys. Copy the results (`packages/load/.data/results` on the load machine) somewhere first.
