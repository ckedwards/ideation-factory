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
  - the files': `s3:GetObject` and `s3:PutObject` on `arn:aws:s3:::<files bucket>/*`, and `s3:ListBucket` on `arn:aws:s3:::<files bucket>` (without it, S3 answers 403 for a file not there yet, and every new file fails).

  If the engine is refused something it needs, its log says so: note it, so `deploy/README.md` can be corrected.

- **Security groups,** with SSH from your address only, and between the machines:
  - nodes: 8080 from the load balancer and the load machine; 6421 between the nodes; 22 from the load machine;
  - load balancer: 443 from the load machine;
  - load machine: 1025 (Mailpit's SMTP) from the nodes.

## Setting it up

1. **Every machine:** `MY_IP=<your address> ./ec2.sh up` makes them in Frankfurt: the network, the security groups, and the five instances on Ubuntu with Docker, at the addresses `10.0.0.10` (the load balancer), `.11`–`.13` (the nodes) and `.20` (the load machine). By hand, elsewhere: Docker with Compose. The load machine also needs Bun, git, and SSH keys to the nodes (for `docker stats`). Give each machine a fixed private address: the seed's snapshots (below) depend on them staying the same.
2. **The nodes:** the repository at the commit being measured (cloned, or pushed from your machine: `git init` there with `receive.denyCurrentBranch updateInstead`, then `git push ubuntu@<address>:ideation-factory <commit>:refs/heads/master`), and fill in `deploy/three-vms/.env` from its example:
   - `NODE_ADDRESS`: each node's own private address;
   - `LB_ADDRESSES`: the load balancer's private address **and the load machine's**, so the app believes the addresses k6 sends for each person (otherwise every person is one address, and sign-in's rate limits throttle the seeder);
   - `S3_ENDPOINT`, `S3_REGION`, the buckets, and the two keys;
   - `RIVET_NODE_VERSION`: the same on every node, such as the commit's time (`git log -1 --format=%ct`); otherwise every actor goes to whichever node built its image last;
   - `IDEAF_SMTP_URL=smtp://<load machine's private address>:1025`, so sign-in codes reach Mailpit;
   - `IDEAF_PERSONAL_TOKENS=on`, as the seeder gets each person a token (otherwise only admins may);
   - `TLS_MODE=internal` (no DNS needed; set `LOAD_INSECURE_TLS=1` on the load machine), or a real name with `acme`.

   Then `docker compose -f node.yaml up -d --build` on each, and wait until the app and directory show healthy. Or, faster and the same build on every node, the published image for the commit ([deploy/README.md](../../deploy/README.md#the-published-image)): `IDEAF_APP_IMAGE=ghcr.io/ckedwards/ideation-factory/app:sha-<commit>` in `.env`, then `docker compose -f node.yaml pull app` and `up -d --no-build`.

3. **The load balancer:** the same `.env`, with `APP_NODES` (the three nodes' `<address>:8080`) and `LB_TRUSTED_PROXIES=<load machine's private address>/32`, so Caddy passes on k6's X-Forwarded-For. Then `docker compose -f lb.yaml up -d`.
4. **The load machine:** clone the repository, `bun install`, then copy `packages/load/remote.env.example` to `packages/load/.data/remote.env` and fill it in. With `TLS_MODE=internal` the deployment's name has no DNS: add it to `/etc/hosts` with the load balancer's private address, for the seeder, and set `LOAD_LB_ADDRESS` to the same address, for k6 (its container doesn't see `/etc/hosts`). Then:

   ```sh
   cd packages/load
   ./remote.sh up        # Mailpit
   ./remote.sh seed      # the design scale: hours, once (see below); resumable if interrupted
   LOAD_RATE=100 LOAD_DURATION=5m ./remote.sh steady
   ```

**RivetKit with the fix for rivet-dev/rivet#5991.** Benchmarks run the app on RivetKit's native module with the fix (rivet-dev/rivet#5992), so they measure the app rather than the bug. On the published 3.1.1, even with its workaround (`IDEAF_DIRECTORY_CALLS=4`), the seed's directory writes fell from about 40 a second to 5 within half an hour (the README's findings). The published `app-bench` image has it: the app's image for the same commit with the module swapped, so its node version is the same. On each node, set `IDEAF_APP_IMAGE=ghcr.io/ckedwards/ideation-factory/app-bench:sha-<commit>` in `.env`, then:

```sh
docker compose -f node.yaml pull app
docker compose -f node.yaml up -d --no-build
```

and `app` in place of `app-bench` for the comparison run on the published RivetKit. The module comes from the RivetKit fix workflow (`.github/workflows/rivetkit-fix.yml`), run by hand once per RivetKit version; until it has run for the version the app pins, CI skips `app-bench`, with a notice. Either way it changes only the code running, not the data, so a seeded deployment can switch back and forth.

Without the registry: build the module with `rivetkit-fix/build.sh` on any Linux machine with Rust, copy it to each node's `packages/load/.data/rivetkit-napi-fixed.node`, and start the app and directory with the overlay (anything that recreates them without it goes back to the published module):

```sh
LOAD_RIVETKIT_VERSION=3.1.1 docker compose -f node.yaml -f ../../packages/load/rivetkit-fix/compose.yaml up -d app directory
```

## The seed: once, then restored

Seeding the design scale is done once per deployment: 37 minutes on the Frankfurt deployment, with nothing failed (ideas 23 minutes, comments 6), where the laptop took two hours. The data lives in the engines' disks and the buckets, and stays through:

- the app's code, settings and images, and RivetKit upgrades that the engine migrates (3.0.6's data went to 3.1.1 as it was);
- moving the directory nodes (the tiers), the load balancer's settings, and anything on the load machine.

It has to be seeded again when:

- the directory's or an idea's schema changes (no migrations during the alpha);
- the engines change: their number, or their addresses.

It can't be made on another machine and copied in: the engine's storage records which engines hold what, at which addresses, so one setup's data doesn't fit another's.

**To go back to the freshly seeded state** after runs have added comments, versions and notifications, keep a copy of it once:

1. Stop the three nodes' containers (`docker compose -f node.yaml stop`), so nothing is mid-write, and keep them stopped until both steps below are done, so the disks and the buckets are of the same moment.
2. Snapshot the three nodes' disks: `aws ec2 create-snapshot --volume-id <the node's volume>`. The snapshot is of that moment as soon as the command returns; completing it takes about half an hour, in the background.
3. Copy both buckets within S3, into new buckets: `aws s3 sync s3://<bucket> s3://<bucket>-seed` (raise `aws configure set default.s3.max_concurrent_requests 64` first). Within a region that's requests only, no transfer: 2 minutes for the engine's 15 GB, 14 for the 100,000 files.

**To restore it** (tried once: the data answered, with no failures, and the write run's comments and files were gone):

1. Stop the three nodes' containers.
2. Put each node's disk back from its snapshot, keeping the instance and its addresses: `aws ec2 create-replace-root-volume-task --instance-id <node> --snapshot-id <its snapshot> --delete-replaced-root-volume`. The instance reboots, and the containers stay stopped, as they were when the snapshot was made.
3. Copy both buckets back: `aws s3 sync s3://<bucket>-seed s3://<bucket> --delete`, then **check every object against the seed**, as `sync` between buckets skips an object of the same size when the copy is newer. The first restore left 54 of the engine's 7,376 objects as the run had rewritten them: its cluster records (`rivet/cluster/coordinator` and the like), which would have started the engines on a mixture. For each bucket:

   ```sh
   for b in <bucket> <bucket>-seed; do
     aws s3api list-objects-v2 --bucket $b --query 'Contents[].[Key,ETag]' --output text | sort > $b.etags
   done
   diff <bucket>.etags <bucket>-seed.etags | sed -n 's/^> //p' | cut -f1 |
     while read -r key; do aws s3 cp "s3://<bucket>-seed/$key" "s3://<bucket>/$key"; done
   ```

   and compare again: no difference left.

4. Start the containers.
5. **Read each node's disk once before measuring** (`sudo dd if=/dev/nvme0n1 of=/dev/null bs=4M iflag=direct`, about half an hour for 100 GB): a disk made from a snapshot loads each block from S3 the first time it's read, and until then the deployment is slow (opening an idea took 7.4 s at the 95th percentile, where the same run took 0.58 s before the restore). The blocks stay loaded through stopping and starting the instance.

## What to measure

- **The tiers:** the page-view rate each layout holds with under 1% failures and a p95 under a second, stepping up in 90 s steps after a warm-up, on RivetKit with the fix:
  - three nodes;
  - three nodes, with the directory's nodes on two machines of their own (move the `directory` services there).

  Then the three nodes once more on the published RivetKit, at the same steps: what a deployment on today's release gets.

- **Reading files:** each app node logs a summary of its file store once a minute (`file store, the last 60 s: … reads, p50 …, p95 …, … ms in all`). Compare the reads' time with the time spent on idea pages (`op_open_idea` and `op_list_comments` in k6's results) to see how much of a page goes on S3.
- **Fail-over:** a node stopped with SIGTERM, a node's app killed, and a whole node (app, directory node and engine) killed, each while a steady run goes on. Note when everything answers again.
- **Deferred commits** (RivetKit 3.1.2-rc.1 or later, the directory only, behind a setting that's off by default): the same steps, with them on and off.
- **What the engines ask of the buckets,** at rest and under load: requests by kind, and bytes read back, which a deployment outside the bucket's cloud pays for (`s3-requests.sh`). Each engine renews its lease every 3 s and lists the bucket every 10 s, about 1,200 PUTs and 360 LISTs an hour, whether anyone uses the app or not.

## A session

From a seeded deployment that's stopped (`./ec2.sh stop`), the three-node tier and the buckets' requests. Times are rough.

1. **Start (5 min),** from your machine, in `packages/load`: `./ec2.sh start`, which prints the new public addresses (they change with each start; the private ones don't). The containers start with their machines. Then `./s3-requests.sh on` (request metrics, about 15 minutes before they show).
2. **The load machine's code:** if `master` has moved since it was set up, `git push ubuntu@<its address>:ideation-factory master` from your checkout (the nodes keep theirs: they run the published image).
3. **On the load machine,** in a `tmux` session so nothing stops if your connection drops (`ssh -t ubuntu@<its address> tmux new -A -s bench`), in `ideation-factory/packages/load`: `./remote.sh up` (Mailpit).
4. **Check the seed (20 min):** `./remote.sh check`. It should end with `0 failed`; if not, restore the seed (above) before measuring on it.
5. **At rest (30 min):** nothing at all. Note the start and end, in UTC (`date -u`).
6. **The tier on the fixed RivetKit (2 × 20 min):** `./remote.sh steps`, twice. Each ends with a table (`steps.tsv`): the last step under 1% failed with a p95 under a second is what three nodes hold. The two should agree within a step.
7. **The tier on the published RivetKit (25 min):** on each node, in `.env`, `IDEAF_APP_IMAGE=ghcr.io/ckedwards/ideation-factory/app:sha-<commit>` (the same commit), then `docker compose -f node.yaml pull app` and `docker compose -f node.yaml up -d --no-build`. Then `./remote.sh steps` once. Switch back to `app-bench` afterwards the same way.
8. **The numbers (10 min),** from your machine:
   - `./s3-requests.sh read <start> <end>` for the time at rest, then for the steps;
   - files: `docker logs ideaf-app-1 2>&1 | grep "file store"` on each node, over the steps;
   - each node's CPU and memory over each step: the `-stats.csv` beside each step's results.
9. **Stop:** copy `.data/results` from the load machine, then `./s3-requests.sh off` and `./ec2.sh stop`.

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
