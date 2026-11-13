# The load test on AWS

The three-VM deployment (`deploy/three-vms`) on EC2 and S3, driven from a machine of its own by `remote.sh`. It checks, on hardware that holds its speed, what was measured on one laptop: the sizing tiers, fail-over, how much of an idea page goes on reading files from S3, and RivetKit 3.1.2's deferred commits. Everything runs only while it's measured: stop the instances between sessions, and tear it all down at the end.

## What to make

| Machine                                        | Count | Type                          | Why                                                                                            |
| ---------------------------------------------- | ----- | ----------------------------- | ---------------------------------------------------------------------------------------------- |
| Node: app, directory node, engine              | 3     | `m7i.2xlarge` (8 vCPU, 32 GB) | Non-burstable, so the CPU holds its speed. The engine used about 5 GB at the design scale.     |
| Load balancer: Caddy                           | 1     | `c7i.large`                   | TLS and round-robin only                                                                       |
| Load: k6, the seeder, Mailpit                  | 1     | `c7i.2xlarge`                 | k6 at 500 requests a second uses a few cores. Kept off the nodes so it doesn't take their CPU. |
| Directory machines (the dedicated tier, later) | 2     | `m7i.2xlarge`                 | Only for that part: the directory nodes move here from the three nodes                         |

Avoid burstable types (`t3`, `t4g`): their CPU credits run out under a long test, and the numbers fall with them.

- **One region, the nodes in three zones,** as a production deployment would be (and as Rivet benchmarks). The load balancer and the load machine go in one of those zones.
- **Disks:** gp3, 100 GB on each node for the engine's write-ahead log and cache. It's local and written constantly: no network file system.
- **Buckets:** two S3 buckets in the same region, for the engine and for files. Block public access; no versioning, since the engine rewrites its own objects.
- **Keys:** an IAM user and access key for each bucket (the app's S3 client can't use an instance role), allowed only its own bucket:
  - the engine's: `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject`, `s3:AbortMultipartUpload` on `arn:aws:s3:::<engine bucket>/*`, and `s3:ListBucket` on `arn:aws:s3:::<engine bucket>`;
  - the files': `s3:GetObject` and `s3:PutObject` on `arn:aws:s3:::<files bucket>/*`, nothing else. If the engine is refused something it needs, its log says so: note it, so `deploy/README.md` can be corrected.
- **Security groups:**
  - nodes: 8080 from the load balancer and the load machine; 6421 between the nodes; 22 from you and the load machine;
  - load balancer: 443 from the load machine and you;
  - load machine: 1025 (Mailpit's SMTP) from the nodes; 22 from you.

## Setting it up

1. **Every machine:** Docker with Compose. The load machine also needs Bun, git, and SSH keys to the nodes (for `docker stats`).
2. **The nodes:** clone the repository at the commit being measured, and fill in `deploy/three-vms/.env` from its example:
   - `NODE_ADDRESS`: each node's own private address;
   - `LB_ADDRESSES`: the load balancer's private address **and the load machine's**, so the app believes the addresses k6 sends for each person (otherwise every person is one address, and sign-in's rate limits throttle the seeder);
   - `S3_ENDPOINT=https://s3.<region>.amazonaws.com`, `S3_REGION`, the buckets, and the two keys;
   - `IDEAF_SMTP_URL=smtp://<load machine's private address>:1025`, so sign-in codes reach Mailpit;
   - `TLS_MODE=internal` (no DNS needed; set `LOAD_INSECURE_TLS=1` on the load machine), or a real name with `acme`.

   Then `docker compose -f node.yaml up -d --build` on each, and wait until the app and directory show healthy.

3. **The load balancer:** the same `.env`, with `APP_NODES` (the three nodes' `<address>:8080`) and `LB_TRUSTED_PROXIES=<load machine's private address>/32`, so Caddy passes on k6's X-Forwarded-For. Then `docker compose -f lb.yaml up -d`.
4. **The load machine:** clone the repository, `bun install`, then copy `packages/load/remote.env.example` to `packages/load/.data/remote.env` and fill it in. Then:

   ```sh
   cd packages/load
   ./remote.sh up        # Mailpit
   ./remote.sh seed      # the design scale: hours; resumable if interrupted
   LOAD_RATE=100 LOAD_DURATION=5m ./remote.sh steady
   ```

The deployment runs the published RivetKit, which has rivet-dev/rivet#5991, with its workaround (`IDEAF_DIRECTORY_CALLS=4`), as people will run it.

## What to measure

- **The tiers:** the page-view rate each layout holds with under 1% failures and a p95 under a second, stepping up in 90 s steps after a warm-up, as `run.sh` was used locally:
  - three nodes;
  - three nodes, with the directory's nodes on two machines of their own (move the `directory` services there).
- **Reading files:** each app node logs a summary of its file store once a minute (`file store, the last 60 s: … reads, p50 …, p95 …, … ms in all`). Compare the reads' time with the time spent on idea pages (`op_open_idea` and `op_list_comments` in k6's results) to see how much of a page goes on S3.
- **Fail-over:** a node stopped with SIGTERM, a node's app killed, and a whole node (app, directory node and engine) killed, each while a steady run goes on. Note when everything answers again.
- **Deferred commits** (RivetKit 3.1.2-rc.1 or later, the directory only, behind a setting that's off by default): the same steps, with them on and off.

## Afterwards

Stop the instances between sessions: their disks keep the data. At the end, terminate them, delete both buckets and the two IAM users' keys, and copy the results (`packages/load/.data/results` on the load machine) somewhere first.
