# Deployment

This replaces the old "single SQLite-file instance" deployment story.
State now lives in two external services instead of on local disk:

- **PostgreSQL** — both the identity and content stores (`lib/identity/db.js`,
  `lib/content/db.js`), as two SQL schemas in one database by default. See
  `lib/db/pg-client.js`.
- **Backblaze B2** (object storage) — post/comment media and avatars in a
  **public** bucket; government-ID/business/professional verification
  documents in a **private** bucket, served only via short-lived signed
  URLs. See `lib/storage.js`.

Because of that, this app is no longer pinned to a single long-running
instance with a mounted volume — any number of instances can point at the
same Postgres database and the same B2 buckets. Serverless/edge platforms
still won't work as-is (this is a stateful Next.js server, not a set of
edge functions — see the API routes section of the README), but any
long-running Node host works, and you can now safely run more than one.

Tables are created automatically the first time the app boots against a
fresh database (`CREATE TABLE IF NOT EXISTS ...` in both `db.js` files) —
there's no separate migration command to run.

---

## 1. Provision PostgreSQL

Any standard Postgres works. Pick one:

- **Railway Postgres** — a plugin inside your Railway project (see
  §3 below); simplest if you're deploying the app to Railway too.
- **Fly Postgres** — a separate Fly app (`fly postgres create`); simplest
  if you're deploying to Fly (see §4 below).
- **Neon** or **Supabase** — free tier, works from anywhere, good choice
  if you want the database decoupled from whichever host runs the app.

Whichever you pick, you end up with one connection string, shaped like:

```
postgres://user:password@host:5432/dbname
```

That's your `DATABASE_URL`. (Optional: set `IDENTITY_DATABASE_URL` and/or
`CONTENT_DATABASE_URL` instead, if you want the PII store and the content
store on physically separate Postgres instances rather than sharing one
via schemas — see `.env.local.example`.)

Managed Postgres almost always requires TLS — that's already the default
in `lib/db/pg-client.js`. Only set `PGSSL=disable` for a local, non-TLS
Postgres you're running yourself (e.g. `docker run postgres` on your own
machine for local dev).

---

## 2. Set up Backblaze B2 (object storage)

1. Create a free account at **backblaze.com** → **B2 Cloud Storage**.
2. Create two buckets (names must be globally unique across all of B2, so
   pick your own prefix):
   - `<yourapp>-media-public` — Files in Bucket are **Public**.
   - `<yourapp>-verification-private` — Files in Bucket are **Private**.
3. Note the **Endpoint** shown on each bucket's details page (same for
   both buckets in one account — something like
   `s3.us-west-004.backblazeb2.com`) and the **region** it implies
   (`us-west-004` in that example).
4. **App Keys** → **Add a New Application Key**. Scope it to both buckets
   (or leave it unscoped for local dev). Save the **keyID** and
   **applicationKey** — the applicationKey is shown once, at creation
   time only.
5. Fill these into your env:

   ```
   B2_KEY_ID=<keyID>
   B2_APPLICATION_KEY=<applicationKey>
   B2_ENDPOINT=https://s3.us-west-004.backblazeb2.com
   B2_REGION=us-west-004
   B2_BUCKET_PUBLIC=<yourapp>-media-public
   B2_BUCKET_PRIVATE=<yourapp>-verification-private
   ```

That's the whole setup — no CORS configuration needed on the buckets
themselves, because uploads go browser → this app's API routes → B2, not
directly browser → B2.

### Optional: a CDN / custom domain in front of the public bucket

B2's own public URL (`https://s3.us-west-004.backblazeb2.com/<bucket>/<key>`)
works out of the box, but egress is cheaper and URLs look nicer through a
CDN. Since you already have a Namecheap domain, the common setup is
**Cloudflare in front of B2**:

1. Add your domain to Cloudflare (free plan is fine) and, at Namecheap,
   change the domain's nameservers to the two Cloudflare gives you
   (Namecheap dashboard → Domain List → Manage → Nameservers → Custom
   DNS).
2. In Cloudflare, add a CNAME record: `media` → your B2 endpoint host
   (e.g. `s3.us-west-004.backblazeb2.com`), proxied (orange cloud on).
3. Backblaze's docs (Cloudflare + B2 "bandwidth alliance") describe a
   Cloudflare Worker that rewrites the path so `media.yourdomain.com/<key>`
   maps to `<bucket>/<key>` on the origin — B2 has a step-by-step guide
   for this linked from their Cloudflare partnership page; follow that
   once your nameservers have propagated.
4. Set `B2_PUBLIC_URL_BASE=https://media.yourdomain.com` in your env.
   Every new upload will build URLs on that domain; nothing needs to be
   backfilled for old uploads unless you want them on the new domain too.

Skipping this section entirely is fine to start — leave
`B2_PUBLIC_URL_BASE` unset and B2's own URL is used.

---

## 3. Deploying to Railway

1. **New Project** → **Deploy from GitHub repo**, pick this repo. Railway
   detects the `Dockerfile` and builds from it automatically.
2. **Add a Postgres**: in the project, **+ New** → **Database** →
   **PostgreSQL**. Railway provisions it and exposes `DATABASE_URL` as a
   variable on that plugin — reference it from your app service's
   variables as `${{Postgres.DATABASE_URL}}` (Railway's variable
   reference syntax), or copy the value directly.
3. On the app service, **Variables** tab, set:

   ```
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   IDENTITY_SIGNING_SECRET=<generate with the node -e command in .env.local.example>
   NEXT_PUBLIC_APP_URL=https://<your-service>.up.railway.app
   B2_KEY_ID=...
   B2_APPLICATION_KEY=...
   B2_ENDPOINT=...
   B2_REGION=...
   B2_BUCKET_PUBLIC=...
   B2_BUCKET_PRIVATE=...
   ```

   Plus whichever optional integrations you're using (Stripe, Resend,
   Google/Apple sign-in, LiveKit, Telnyx, KLIPY — same variables as
   `.env.local.example`).
4. **Deploy**. Railway builds the Docker image and starts it; watch the
   deploy log for the app booting (both `db.js` files log nothing on
   success — the absence of a thrown connection error is the signal).
5. Once it's up, update `NEXT_PUBLIC_APP_URL` to match the actual
   Railway-assigned domain (or your custom domain — see §5) and redeploy,
   since Stripe/email links are built from that value.
6. **Custom domain**: Railway service → **Settings** → **Networking** →
   **Custom Domain** → enter your domain/subdomain. Railway gives you a
   CNAME target; add it at Namecheap (see §5).

Railway needs no volume/mount step — Postgres and B2 are both external.

---

## 4. Deploying to Fly.io

`Dockerfile`, `.dockerignore`, and `fly.toml` are already in this repo,
updated for the Postgres/B2 setup (no volume is mounted anymore).

```bash
# 1. Install the CLI and log in
curl -L https://fly.io/install.sh | sh
fly auth login

# 2. Claim an app name (edit fly.toml's `app =` line to match, or let
#    `fly launch` generate one and choose not to overwrite fly.toml —
#    it's already written for you)
fly launch --no-deploy

# 3. Postgres — either a Fly Postgres app in the same org...
fly postgres create --name <your-app>-db --region iad
fly postgres attach <your-app>-db --app <your-app>
#    ...which sets DATABASE_URL as a secret on your app automatically, or
#    skip this and instead `fly secrets set DATABASE_URL=...` with a
#    connection string from Neon/Supabase/Railway Postgres/anywhere else.

# 4. Set the remaining secrets — never put real secrets in fly.toml or commit them
fly secrets set IDENTITY_SIGNING_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
fly secrets set NEXT_PUBLIC_APP_URL=https://<your-app-name>.fly.dev
fly secrets set B2_KEY_ID=... B2_APPLICATION_KEY=... B2_ENDPOINT=... B2_REGION=... \
                B2_BUCKET_PUBLIC=... B2_BUCKET_PRIVATE=...
# plus Stripe/Resend/Google/Apple/LiveKit/Telnyx/KLIPY if you're using them:
fly secrets set STRIPE_SECRET_KEY=sk_live_...
fly secrets set STRIPE_PRICE_ID=price_...
fly secrets set STRIPE_WEBHOOK_SECRET=whsec_...

# 5. Deploy
fly deploy

# 6. Open it
fly open
```

After that, point a real Stripe webhook (Dashboard → Developers →
Webhooks) at `https://<your-app-name>.fly.dev/api/stripe/webhook` (or
your custom domain, once set up below) — local `stripe listen` forwarding
won't reach a deployed app.

Fly now supports more than one machine (`fly scale count 2`) since
nothing is pinned to local disk anymore — do that once you actually need
the headroom, not before.

**Custom domain on Fly**: `fly certs add yourdomain.com` (or
`app.yourdomain.com`), then add the DNS records it prints at Namecheap
(see §5) — normally an A/AAAA record pair for an apex domain, or a CNAME
for a subdomain. `fly certs show yourdomain.com` to check propagation.

---

## 5. Pointing your Namecheap domain at either one

1. Namecheap dashboard → **Domain List** → **Manage** on your domain →
   **Advanced DNS**.
2. Add the record your host gave you in §3 or §4:
   - **Railway**: a `CNAME` record, host `www` (or your chosen
     subdomain) → the target Railway shows on the Custom Domain screen.
     For an apex/root domain (`yourdomain.com` with no subdomain),
     Railway's dashboard will tell you whether it needs an `ALIAS`/`ANAME`
     record instead — Namecheap supports this under Advanced DNS as well.
   - **Fly**: `fly certs add` prints the exact record(s) to add — usually
     an `A` and `AAAA` pair for an apex domain, or a `CNAME` for a
     subdomain.
3. DNS propagation is usually minutes, occasionally up to ~24 hours.
4. Update `NEXT_PUBLIC_APP_URL` (Railway variable / `fly secrets set`) to
   the final `https://yourdomain.com`, redeploy, and update any Stripe
   webhook / Google OAuth redirect URI / Apple redirect URI to match the
   new domain.

If you set up the optional Cloudflare-in-front-of-B2 CDN in §2, that's a
**separate** subdomain (e.g. `media.yourdomain.com`) pointed at B2, not
at Railway/Fly — the app's own domain and the media CDN domain are two
different DNS records.

---

## 6. Migrating existing SQLite data

If you have real data sitting in local `data/identity.db` /
`data/content.db` files from before this migration, this repo doesn't
ship an automatic migration script (there was no data to migrate in this
project at the time of the change). The shape of one, if you need it:

1. Read each table with `node:sqlite`'s `DatabaseSync` (the same API the
   old `db.js` files used) against the old files.
2. Insert each row into the corresponding Postgres table via the new
   `contentDb`/`identityDb` (from `lib/content/db.js` /
   `lib/identity/db.js`) — column names are unchanged, so a straight
   `INSERT INTO <table> (...) VALUES (...)` per row works.
3. For media/avatars/verification docs previously on local disk under
   `data/media/`, `data/avatars/`, `data/verification-docs/`: upload each
   file to the appropriate B2 bucket with `uploadPublicObject` /
   `uploadPrivateObject` from `lib/storage.js`, then `UPDATE` the owning
   row's `media_path` / `avatar_path` / `document_path` column with the
   URL (public) or key (private) that upload returns.

Run it once, locally, pointed at both the old SQLite files and the new
`DATABASE_URL`/B2 credentials, before cutting traffic over.

---

## Before this touches real users

- Set a real `IDENTITY_SIGNING_SECRET` (see §3/§4 above) — without it the
  app falls back to an insecure dev default.
- `NODE_ENV=production` (already set in `fly.toml` / set it in Railway's
  variables) so session cookies get `secure: true`.
- Point `NEXT_PUBLIC_APP_URL` at the real deployed domain — Stripe's
  success/cancel/portal-return URLs and email links are built from it.
- Confirm `B2_BUCKET_PRIVATE` really is set to Private in the B2
  dashboard (not Public) before any real verification documents are
  uploaded to it.
