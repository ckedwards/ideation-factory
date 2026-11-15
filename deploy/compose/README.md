# Trying Ideation Factory with Docker Compose

Everything on one machine, from our published images, to see it working. It keeps its data in two Docker volumes on this machine, and catches every email in Mailpit, with no buckets, TLS or mail account. For production, which wants three machines or more and buckets, see [VMs or bare metal](../vm/README.md).

```sh
cd deploy/compose
./create-env.sh          # new secrets, and the admin's email (any address: see below)
docker compose up -d
```

Then open http://localhost:8080 and sign in with the admin's email. The code is in Mailpit, at http://localhost:8025. It's up once `docker compose ps` shows the app healthy, about half a minute after it starts.

`create-env.sh` writes `.env` from `.env.example`, which lists the other settings. It won't replace a `.env` that's there.

## Email: Mailpit

Every email the app sends, sign-in codes and notifications alike, goes to Mailpit, an inbox on this machine: none reaches anyone's own address. So any address works, for the admin and for anyone you add, and anyone who can open Mailpit can sign in as anyone. That's why it's only on this machine (`127.0.0.1`).

- **On a server of its own:** reach Mailpit through SSH, with `ssh -L 8025:localhost:8025 <the server>`, then http://localhost:8025 on your own machine.
- **Email for real,** so people get their own codes: set `IDEAF_SMTP_URL`, `IDEAF_EMAIL_FROM` and `IDEAF_NOTIFY_FROM` in `.env` to a relay you have (Amazon SES, Postmark, Mailgun, Resend, Gmail with an app password, your company's), then `docker compose up -d`. Mailpit then sits idle.

## What runs

- **engine:** our build of the Rivet Engine, alone, as in Rivet's [Docker Compose guide](https://rivet.dev/docs/deploy/self-host/control-plane/docker-compose/). It keeps everything in the `engine` volume.
- **pool:** a one-off step that creates the engine's node pool, which the app joins.
- **app:** the server, with the web app built in, on port 8080. It keeps ideas' files in the `app` volume.
- **mailpit:** the inbox for its email, on port 8025 of this machine.

## Changing things

- **From another machine:** set `IDEAF_URL` to the address people use, like `http://server.example.com:8080`. Over plain HTTP, only for trying it on a network you trust.
- **A newer build:** `docker compose pull && docker compose up -d`. `IDEAF_VERSION` picks another: a release (`v0.1.<n>`), `master` for the newest commit, or a commit's `sha-<7 characters>`.
- **Start again from nothing:** `docker compose down -v` deletes the data; then `rm .env` and `./create-env.sh` for new secrets.
