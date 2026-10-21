# Running Q express on Oracle Cloud

The same app Render runs, on an Oracle Cloud "Always Free" server that does
not sleep, with its own PostgreSQL on the same server (Neon's free compute
allowance does not last a month for an app that never sleeps). The pictures
stay on Cloudinary.

- `create-server.sh` opens the server itself from Oracle's Cloud Shell, in one
  paste: network, firewall, an Always Free Ampere server with the owner's SSH
  key, a fixed public IP and a 1 USD budget alert. It prints the IP.
- `setup.sh` prepares the fresh Ubuntu 24.04 server once: Node.js, PostgreSQL,
  Caddy for HTTPS, the firewall, the services, and a settings file for the
  secrets.
- `import-neon.sh` copies the whole database from Neon to this server and
  compares every table's row count.
- `backup.sh` saves a copy of the database every night (the last 14 are kept
  in `/var/backups/q-express`).
- `update.sh` builds the newest commit on GitHub's `main` and switches over to
  it. A timer runs it every two minutes, so a push goes live within a few
  minutes, as with Render's auto-deploy. A failed build or a version that does
  not start leaves the running one in place.
- `q-express.service` runs the app; `q-express-update.timer` runs the updates.

## The server

Oracle Cloud, home region **Netherlands Northwest (Amsterdam)**, the owner's
existing account.
`create-server.sh` makes every choice below; by hand, Compute > Instances >
Create instance with

- image **Canonical Ubuntu 24.04**;
- shape **VM.Standard.A1.Flex** (Ampere, "Always Free-eligible"), 2 OCPU and
  12 GB memory (the free allowance); a VM.Standard.E2.1.Micro also works,
  more slowly;
- a public IPv4 address (a reserved one keeps the address if the server is
  ever made again) and the SSH key;
- in the subnet's security list, ingress rules for TCP ports **22**, **80** and
  **443** from `0.0.0.0/0`.

## First setup

On the server (`ssh -i ~/.ssh/qexpress ubuntu@<ip>`):

```sh
sudo apt-get update && sudo apt-get install -y git
git clone https://github.com/shoxruxnosirov/q-express.git ~/q-express
sudo bash ~/q-express/deploy/oracle/setup.sh --email you@example.com
sudo nano /etc/q-express/env      # copy every value from Render, see below
sudo bash ~/q-express/deploy/oracle/import-neon.sh
sudo bash ~/q-express/deploy/oracle/setup.sh
```

`DATABASE_URL` is already filled in with this server's own database; leave it,
do not copy Render's. `import-neon.sh` asks for Neon's connection string
(Render's `DATABASE_URL`) without showing it and keeps it nowhere.

`SESSION_SECRET` must be Render's own value: the shops' bot tokens are
encrypted with it. Values go in as they are, without quotes.
`TELEGRAM_CONNECT=off` stays as it is until the move: with it the app leaves
every bot's webhook and menu button alone, so a mistyped value here cannot take
the bots away from Render.

The site is then at `https://<ip-with-dashes>.sslip.io` (or the name given
with `--domain`).

The email goes only to the certificate authorities. All sslip.io names share
one weekly Let's Encrypt limit; with an email Caddy falls back to ZeroSSL when
that limit is reached.

## Moving over from Render

1. Try the site at the new address in a browser: the shop, the admin panel
   (admins sign in again, the address is new), a picture upload. Inside
   Telegram the shop still opens on Render: that is the point of this step.
   Leave the shops' bot settings alone meanwhile (a bot saved here is
   connected only at step 3). This server has its own copy of the data now:
   whatever is done here is replaced in step 2, and real orders still go to
   Render.
2. Suspend the Render service (q-express > Settings > Suspend). A Render
   instance that wakes up points the bots back at itself. Then run
   `sudo bash ~/q-express/deploy/oracle/import-neon.sh` once more, so the last
   orders come over; every count must match.
3. `sudo bash ~/q-express/deploy/oracle/setup.sh --go-live`: the bots now
   point here. It first makes sure every bot's token can be read with these
   settings, and refuses otherwise: a SESSION_SECRET that is not exactly
   Render's would leave every shop's own bot silent after the move. Messages sent between steps 2 and 3 are not lost; Telegram
   holds them until the new address answers. Before Q express's bot moves,
   the app gives each customer's own menu button (one in Russian or English)
   the new address; the log says "The chats' menu buttons were moved".
4. In BotFather, set the Mini App URL of @Q_express_bot (and of any shop's own
   bot) to the new address.

Buttons in Telegram messages sent before the move still lead to
the Render address.

## Day to day

```sh
systemctl status q-express                    # running?
journalctl -u q-express -f                    # app log
journalctl -u q-express-update -n 50          # last updates
sudo nano /etc/q-express/env && sudo systemctl restart q-express
sudo /usr/local/lib/q-express/update.sh --force   # rebuild now
```

A new address (a domain bought later, or the IP changed):
`sudo bash ~/q-express/deploy/oracle/setup.sh --domain example.com` (or
`--domain auto` for `<ip>.sslip.io`). Everyone signs in again, and once live
the bots follow.

`update.sh` runs as root, so the server takes it only from `~/q-express`, never
from GitHub by itself: after a change to it,
`git -C ~/q-express pull && sudo bash ~/q-express/deploy/oracle/setup.sh`.
Running `setup.sh` again is safe; it rebuilds only for a new commit and
restarts only for changed settings.

The last three releases are kept in `/opt/q-express/releases`; `current` is a
symlink to the one running.

Oracle may reclaim an Always Free server that sits idle for a week on a free
account; upgrading the account to Pay As You Go (still free within the Always
Free limits) avoids that. Nothing tells anyone when the server is down: a free
uptime monitor (UptimeRobot or similar) on `https://<address>/api/healthz`
does.
