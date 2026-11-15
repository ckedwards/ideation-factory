# A load balancer: Caddy

For VMs without a cloud load balancer: Caddy on a machine of its own, in front of every machine's app. It does TLS, sends requests round-robin to the apps that pass their health check, and retries a request on another app when one can't be reached. That's the setup the load tests' fail-over results come from.

1. Install Caddy from its package, which runs it under systemd: [caddyserver.com/docs/install](https://caddyserver.com/docs/install) (Debian and Ubuntu, Fedora and RHEL, and others).
2. Copy `Caddyfile` here to `/etc/caddy/Caddyfile` and edit its two marked lines: the name people reach it by, and the machines' private addresses.
3. `systemctl reload caddy`.

On the app machines, put this machine's private address in `IDEAF_TRUSTED_PROXIES` (`/etc/ideaf/ideaf.env`), so the apps take each person's address from it: sign-in's rate limits count per person.

**A cloud load balancer instead** does the same: TLS, the apps' port 8080 as its targets, a health check on `/health`, and an hour's idle timeout, so live updates' WebSockets stay open.
