#!/usr/bin/env bash
# Prepares a fresh Oracle Cloud Ubuntu 24.04 server (Ampere ARM or AMD) to run
# Q express, the same app Render runs: one Node process serving the API and the
# built web app, behind Caddy for HTTPS, with its own PostgreSQL on this server
# (reached over the local socket, never from outside). The pictures stay on
# Cloudinary. import-neon.sh copies the data over from Neon.
#
#   sudo bash deploy/oracle/setup.sh --email you@example.com   first run, then again once the settings are in
#   sudo bash deploy/oracle/setup.sh --domain example.com      a new address (--domain auto: <its-ip>.sslip.io)
#   sudo bash deploy/oracle/setup.sh --go-live                 the bots move here (Render suspended first)
#
# Safe to run again. The first run writes /etc/q-express/env and stops there
# so its secrets can be filled in; the next run builds and starts the app.
# Without --domain the server's address is <its-ip>.sslip.io, a free name that
# points at the IP, which is enough for HTTPS and for Telegram.
#
# Moving over is in two steps. Until --go-live, TELEGRAM_CONNECT=off keeps the
# app here away from every bot's webhook and menu button (it would point them
# here on start, and when a shop's bot is saved), so they stay with Render
# while the site is tried out. --go-live turns that off; on that start the app
# moves the bots, and the customers' own menu buttons, to this address.
#
# The email is for the HTTPS certificate. Every sslip.io name shares one weekly
# Let's Encrypt limit (sslip.io is not on the Public Suffix List), so it can
# run out; with an email Caddy falls back to ZeroSSL, which has no such limit.
# It is kept in the settings file, so later runs need not repeat it.
#
# update.sh is installed from this copy of the repository only, never from what
# the app user can write, since it runs as root: after a change to it, pull this
# copy and run this script again.
set -euo pipefail

NODE_VERSION=24.15.0
REPO_URL=${QE_REPO_URL:-https://github.com/shoxruxnosirov/q-express.git}
APP_USER=qexpress
APP_DIR=/opt/q-express
APP_HOME=/var/lib/q-express
ENV_FILE=/etc/q-express/env
LIB_DIR=/usr/local/lib/q-express
PORT=3000
PG_MAJOR=18
DB_NAME=qexpress
LOCAL_DATABASE_URL="postgresql://$APP_USER@/$DB_NAME?host=/var/run/postgresql"

[[ $EUID -eq 0 ]] || { echo "Run it with sudo: sudo bash $0" >&2; exit 1; }
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

domain=
email=
go_live=false
while [[ $# -gt 0 ]]; do
  case $1 in
    --domain) domain=${2:?--domain needs a name}; shift 2 ;;
    --email) email=${2:?--email needs an address}; shift 2 ;;
    --go-live) go_live=true; shift ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done
if [[ -n $email && ! $email =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]]; then
  echo "Not an email address: $email" >&2
  exit 1
fi
if [[ $domain == auto ]]; then
  ip=$(curl -4fsS https://api.ipify.org)
  domain=${ip//./-}.sslip.io
fi
if [[ -n $domain && ! $domain =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]]; then
  echo "Not a domain name: $domain (give it without https://)" >&2
  exit 1
fi

step() { printf '\n== %s\n' "$*"; }
value() { sed -n "s/^$1=//p" $ENV_FILE | tail -1; }
# Sets NAME=value in the settings file, adding the line when it is missing.
put() {
  if grep -q "^$1=" $ENV_FILE; then
    sed -i "s|^$1=.*|$1=$2|" $ENV_FILE
  else
    printf '%s=%s\n' "$1" "$2" >> $ENV_FILE
  fi
}

step "System packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q git curl ca-certificates xz-utils caddy iptables-persistent

# A small (1 GB) AMD server cannot build the web app in memory alone.
mem_kb=$(awk '/MemTotal/ {print $2}' /proc/meminfo)
if (( mem_kb < 3000000 )) && ! swapon --show | grep -q /swapfile; then
  step "Swap (2 GB) for building on a small server"
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

step "Node.js $NODE_VERSION"
case $(uname -m) in
  aarch64) arch=arm64 ;;
  x86_64) arch=x64 ;;
  *) echo "Unsupported CPU: $(uname -m)" >&2; exit 1 ;;
esac
node_dir=/opt/node-v$NODE_VERSION-linux-$arch
if [[ ! -x $node_dir/bin/node ]]; then
  tmp=$(mktemp -d)
  file=node-v$NODE_VERSION-linux-$arch.tar.xz
  curl -fsSL -o "$tmp/$file" "https://nodejs.org/dist/v$NODE_VERSION/$file"
  curl -fsSL -o "$tmp/SHASUMS256.txt" "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt"
  (cd "$tmp" && grep " $file\$" SHASUMS256.txt | sha256sum -c -)
  tar -xJf "$tmp/$file" -C /opt
  rm -rf "$tmp"
fi
for bin in node npm npx corepack; do ln -sfn "$node_dir/bin/$bin" /usr/local/bin/$bin; done
corepack enable --install-directory /usr/local/bin pnpm

step "App user and code"
# The app user owns the code it builds and its own home (the pnpm store), but
# not $APP_DIR itself: the "current" link and the update state there are
# root's, so a broken-into app cannot steer what root does next.
id -u $APP_USER >/dev/null 2>&1 || useradd --system --home-dir $APP_HOME --shell /usr/sbin/nologin $APP_USER
install -d -o $APP_USER -g $APP_USER -m 750 $APP_HOME
install -d -o root -g root -m 755 $APP_DIR $APP_DIR/releases
install -d -o $APP_USER -g $APP_USER $APP_DIR/repo
[[ -d $APP_DIR/repo/.git ]] || runuser -u $APP_USER -- env HOME=$APP_HOME git clone --quiet "$REPO_URL" $APP_DIR/repo

step "PostgreSQL $PG_MAJOR"
# From PostgreSQL's own repository rather than Ubuntu's: its pg_dump must be at
# least as new as Neon's server for import-neon.sh.
if [[ ! -f /etc/apt/sources.list.d/pgdg.list ]]; then
  install -d /usr/share/postgresql-common/pgdg
  curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc
  echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(. /etc/os-release && echo "$VERSION_CODENAME")-pgdg main" \
    > /etc/apt/sources.list.d/pgdg.list
  apt-get update -q
fi
apt-get install -y -q postgresql-$PG_MAJOR
# The local socket only, and memory sized to the server (128 MB on a 1 GB one).
mem_mb=$(( mem_kb / 1024 ))
pg_conf=/etc/postgresql/$PG_MAJOR/main/conf.d/q-express.conf
pg_new=$(cat <<EOF
# Written by deploy/oracle/setup.sh.
listen_addresses = ''
shared_buffers = $(( mem_mb / 8 > 128 ? mem_mb / 8 : 128 ))MB
effective_cache_size = $(( mem_mb / 2 ))MB
EOF
)
if [[ $(cat $pg_conf 2>/dev/null) != "$pg_new" ]]; then
  printf '%s\n' "$pg_new" > $pg_conf
  systemctl restart postgresql@$PG_MAJOR-main
fi
systemctl enable --now postgresql >/dev/null
# The app signs in as its own system user over the socket (peer), so there is
# no database password anywhere.
as_pg() { runuser -u postgres -- "$@"; }
[[ $(as_pg psql -tAc "SELECT 1 FROM pg_roles WHERE rolname = '$APP_USER'") == 1 ]] || as_pg createuser $APP_USER
[[ $(as_pg psql -tAc "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'") == 1 ]] || as_pg createdb -O $APP_USER $DB_NAME

step "Firewall: ports 80 and 443"
# Oracle's Ubuntu images reject everything but SSH in iptables, on top of the
# security list in the Oracle console (which must allow 80 and 443 as well).
for p in 80 443; do
  iptables -C INPUT -p tcp --dport $p -j ACCEPT 2>/dev/null || iptables -I INPUT -p tcp --dport $p -j ACCEPT
done
netfilter-persistent save >/dev/null

step "Settings file $ENV_FILE"
if [[ ! -f $ENV_FILE ]]; then
  if [[ -z $domain ]]; then
    ip=$(curl -4fsS https://api.ipify.org)
    domain=${ip//./-}.sslip.io
  fi
  install -d -m 750 -g $APP_USER /etc/q-express
  install -m 640 -g $APP_USER /dev/null $ENV_FILE
  cat > $ENV_FILE <<EOF
# Q express settings, read by the app at start. After a change:
#   sudo systemctl restart q-express
# One NAME=value per line, no quotes and no spaces around "=".

NODE_ENV=production
PORT=$PORT
# Relative to the release the app runs from.
CLIENT_DIST_DIR=artifacts/qorasuv-express/dist/public
# This server's address: the HTTPS certificate's (setup.sh --domain changes
# it), and where Telegram and the bots' buttons send people.
PUBLIC_BASE_URL=https://$domain
# "off" until the move: the bots stay where they are (with Render) while this
# server is tried out. "setup.sh --go-live" sets it to "on", and the app then
# points every bot here.
TELEGRAM_CONNECT=off
# For the HTTPS certificate only (see setup.sh); the app does not read it.
ACME_EMAIL=

# This server's own database (see setup.sh); not Render's value.
DATABASE_URL=$LOCAL_DATABASE_URL

# Copied from Render (q-express > Environment), every value exactly as there.
# SESSION_SECRET above all: the shops' bot tokens are encrypted with it, and a
# different one leaves every shop bot to be entered again.
SESSION_SECRET=
ADMIN_ACCESS_CODE=
TELEGRAM_BOT_MODE=legacy
TELEGRAM_BOT_TOKEN=
TELEGRAM_BOT_USERNAME=
TELEGRAM_ADMIN_CHAT_ID=
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
# Any other variable Render has goes here too, e.g. TELEGRAM_NEW_BOT_TOKEN.
EOF
elif [[ -n $domain ]]; then
  # Once live, the bots follow it on the restart below.
  put PUBLIC_BASE_URL "https://$domain"
fi
[[ -n $email ]] && put ACME_EMAIL "$email"
# A settings file from before the database moved here still says Neon or nothing.
[[ $(value DATABASE_URL) == "$LOCAL_DATABASE_URL" ]] || put DATABASE_URL "$LOCAL_DATABASE_URL"
email=$(value ACME_EMAIL)
site=$(value PUBLIC_BASE_URL)
domain=${site#https://}
domain=${domain%%/*}
[[ $site == https://* && -n $domain ]] || { echo "PUBLIC_BASE_URL in $ENV_FILE must be https://<this server's address>" >&2; exit 1; }
live() { [[ $(value TELEGRAM_CONNECT) != off ]]; }

# systemd reads the file without a shell: quotes stay part of the value, and a
# space around "=" breaks the line.
if grep -nE '^[A-Za-z_]+ +=|^[A-Za-z_]+= |^[A-Za-z_]+=.*["'"'"'\\]' $ENV_FILE >&2; then
  echo "WARNING: the lines above have quotes, a backslash or spaces around \"=\"; check them against Render." >&2
fi

step "HTTPS for $domain"
{
  echo "# Written by deploy/oracle/setup.sh. Caddy fetches and renews the certificate."
  if [[ -n $email ]]; then
    printf '{\n\temail %s\n}\n\n' "$email"
  else
    echo "WARNING: no --email given; if Let's Encrypt refuses sslip.io, there is no fallback." >&2
  fi
  cat <<EOF
$domain {
	encode zstd gzip
	reverse_proxy 127.0.0.1:$PORT
}
EOF
} > /etc/caddy/Caddyfile
systemctl enable --now caddy >/dev/null
systemctl reload caddy

step "Services"
install -d $LIB_DIR
install -m 755 "$here/update.sh" "$here/backup.sh" $LIB_DIR/
install -m 644 "$here/q-express.service" "$here/q-express-update.service" "$here/q-express-update.timer" \
  "$here/q-express-backup.service" "$here/q-express-backup.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable q-express.service >/dev/null
systemctl enable --now q-express-backup.timer >/dev/null

if $go_live && live; then
  echo "Already live at $site."
  go_live=false
fi
if $go_live; then
  [[ -L $APP_DIR/current ]] || { echo "The app is not running yet: run this script without --go-live first." >&2; exit 1; }

  # A SESSION_SECRET that is not Render's leaves every shop's own bot silent
  # after the move (its token is encrypted with Render's), and an empty bot
  # token the main bot. The app reports both on start, even while it leaves the
  # bots alone, so its current start (with these settings) must be clean.
  if [[ $(sha256sum < $ENV_FILE) != "$(cat $APP_DIR/env.sha 2>/dev/null)" ]]; then
    step "Restart with the changed settings"
    systemctl restart q-express
    sha256sum < $ENV_FILE > $APP_DIR/env.sha
  fi
  step "Checking the bots' tokens and SESSION_SECRET"
  since=$(date -d "$(systemctl show -p ActiveEnterTimestamp --value q-express)" '+%F %T')
  # Read whole, not piped into grep -q: under pipefail an early grep exit
  # would make a match look like a failure.
  applog=
  for _ in $(seq 120); do
    applog=$(journalctl -u q-express --since "$since" --no-pager -o cat)
    grep -qE '"msg":"Shop bots (checked|not registered)"' <<<"$applog" && break
    sleep 5
  done
  if ! grep -q '"msg":"Shop bots checked"' <<<"$applog"; then
    echo "The app has not finished checking the bots (journalctl -u q-express -n 50). Nothing changed." >&2
    exit 1
  fi
  unusable=$(grep '"msg":"Telegram webhook not registered"' <<<"$applog" | grep '"reason":"Telegram bot configuration is missing"' || true)
  if [[ -n $unusable ]]; then
    shops=$(grep -o '"shopId":[0-9]*' <<<"$unusable" | cut -d: -f2 | sort -nu | paste -sd, -)
    cat >&2 <<EOF
The bots of shop(s) $shops cannot be used with these settings. Shop 1 is Q
express: its bot token is empty (TELEGRAM_BOT_TOKEN, or TELEGRAM_NEW_BOT_TOKEN
with TELEGRAM_BOT_MODE=new). Any other: SESSION_SECRET is not exactly Render's,
so the shop's stored bot token cannot be read. Copy it from Render again
(sudo nano $ENV_FILE), then run this again. A shop whose bot is silent on
Render too: enter its token again in the admin panel here. Nothing changed.
EOF
    exit 1
  fi
  echo "    every bot's token can be read"
  cat <<EOF

The bots are about to move to $site.
Suspend the Render service first (q-express > Settings > Suspend): a Render
that wakes up points them back at itself. Messages sent in between are not
lost; Telegram holds them until the new address answers.
EOF
  answer=
  # Tried in a subshell first: without a terminal, opening /dev/tty fails.
  if ( : </dev/tty ) 2>/dev/null; then
    read -r -p 'Is Render suspended? Type yes: ' answer </dev/tty || answer=
  else
    echo "No terminal to ask on: run it in an SSH session." >&2
  fi
  [[ $answer == yes ]] || { echo "Nothing changed." >&2; exit 1; }
  put TELEGRAM_CONNECT on
fi

missing=()
for name in DATABASE_URL SESSION_SECRET; do [[ -n $(value $name) ]] || missing+=("$name"); done
if (( ${#missing[@]} )); then
  cat <<EOF

Almost there. Fill in the settings copied from Render:
  sudo nano $ENV_FILE
Still empty: ${missing[*]}
Then run this script again.
EOF
  exit 0
fi

if [[ -L $APP_DIR/current ]]; then
  # Built already: build only a newer commit, and restart only for changed settings.
  step "Update"
  $LIB_DIR/update.sh || echo "The update failed (see above); the running version stays." >&2
  if [[ $(sha256sum < $ENV_FILE) != "$(cat $APP_DIR/env.sha 2>/dev/null)" ]]; then
    step "Restart with the changed settings"
    systemctl restart q-express
    sha256sum < $ENV_FILE > $APP_DIR/env.sha
  fi
else
  step "First build (a few minutes)"
  $LIB_DIR/update.sh --force || { echo "The first build failed (see above). Run this script again." >&2; exit 1; }
fi
systemctl enable --now q-express-update.timer >/dev/null

if live; then
  cat <<EOF

Q express is running at $site, and the bots point here.
In BotFather, set the Mini App URL of @Q_express_bot (and of any shop's own
bot with one) to $site.
EOF
else
  cat <<EOF

Q express is running at $site for trying out.
The bots stay where they are (with Render): inside Telegram, the shop still
opens there. Once the site works here, suspend Render and run
  sudo bash $here/setup.sh --go-live
EOF
fi
cat <<EOF
  status:    systemctl status q-express
  app log:   journalctl -u q-express -f
  updates:   journalctl -u q-express-update -n 50
New commits on GitHub's main are picked up within a few minutes.
EOF
