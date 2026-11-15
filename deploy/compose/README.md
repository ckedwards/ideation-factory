# Trying Ideation Factory with Docker Compose

Everything on one machine, from our published images, to see it working. It keeps its data in two Docker volumes on this machine, with no buckets, TLS or mail server. For production, which wants three machines or more and buckets, see [VMs or bare metal](../vm/README.md).

```sh
cd deploy/compose
cp .env.example .env     # two secrets (openssl rand -hex 32) and your email
docker compose up -d
```

Then open http://localhost:8080 and sign in with the email in `IDEAF_SITE_ADMINS`. The code is in the app's log:

```sh
docker compose logs app | grep "sign-in code"
```

It's up once `docker compose ps` shows the app healthy, about half a minute after it starts.

## What runs

- **engine:** our build of the Rivet Engine, alone, as in Rivet's [Docker Compose guide](https://rivet.dev/docs/deploy/self-host/control-plane/docker-compose/). It keeps everything in the `engine` volume.
- **pool:** a one-off step that creates the engine's node pool, which the app joins.
- **app:** the server, with the web app built in, on port 8080. It keeps ideas' files in the `app` volume.

## Changing things

- **Email for real,** so other people can sign in too: set `IDEAF_SMTP_URL` and `IDEAF_EMAIL_FROM` to a relay you have (Amazon SES, Postmark, Mailgun, Resend, Gmail with an app password, your company's), then `docker compose up -d`.
- **From another machine:** set `IDEAF_URL` to the address people use, like `http://server.example.com:8080`. Over plain HTTP, only for trying it on a network you trust.
- **A newer build:** `docker compose pull && docker compose up -d`. `IDEAF_VERSION` picks another: a release (`v0.1.<n>`), `master` for the newest commit, or a commit's `sha-<7 characters>`.
- **Start again from nothing:** `docker compose down -v` deletes the data.
