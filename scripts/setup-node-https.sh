#!/usr/bin/env bash
# One-time LOCAL owner bootstrap. Does not request a certificate or start a public listener.
set -euo pipefail
if [ "$(id -u)" -ne 0 ]; then echo 'Run this one-time bootstrap locally with sudo/root.' >&2; exit 1; fi
operator=""
port=""
while [ "$#" -gt 0 ]; do
 case "$1" in
  --user) operator="${2:-}"; shift 2 ;;
  --port) port="${2:-}"; shift 2 ;;
  *) echo 'Usage: sudo bash scripts/setup-node-https.sh --user NODE_OS_USER --port NODE_HTTP_PORT' >&2; exit 2 ;;
 esac
done
[[ "$operator" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || { echo 'A local non-root node user is required.' >&2; exit 2; }
[[ "$port" =~ ^[0-9]{4,5}$ ]] && [ "$port" -ge 1024 ] && [ "$port" -le 65535 ] && [ "$port" -ne 2019 ] || { echo 'Use a local gateway HTTP port between 1024 and 65535.' >&2; exit 2; }
operator_uid="$(id -u "$operator")"
[ "$operator_uid" -gt 0 ] && [ "$operator" != gstd-node-https ] || { echo 'The node must run as a non-root user.' >&2; exit 2; }
[ -d /run/systemd/system ] && command -v systemctl >/dev/null && command -v apt-get >/dev/null || { echo 'Automatic bootstrap supports Debian/Ubuntu with systemd. For other systems use an administrator-managed HTTPS proxy.' >&2; exit 1; }
source_dir="$(cd -- "$(dirname -- "$0")" && pwd)"
[ -f "$source_dir/node-https-helper.py" ] || { echo 'Missing helper source; use the complete GSTD checkout.' >&2; exit 1; }
for service in caddy nginx apache2 haproxy; do
 if systemctl is-active --quiet "$service.service"; then echo 'An existing web proxy is active. It will not be modified; configure it with your administrator.' >&2; exit 1; fi
done
# Validate root-owned parents and marker BEFORE reading any saved bootstrap data.
for target in /etc/gstd-node-https /usr/local/lib/gstd-node-https; do
 [ ! -L "$target" ] || { echo 'Unsafe managed parent symlink.' >&2; exit 1; }
 if [ -e "$target" ]; then
  [ -d "$target" ] && [ "$(stat -c %u "$target")" -eq 0 ] && [ $((8#$(stat -c %a "$target") & 022)) -eq 0 ] || { echo 'Unsafe managed parent ownership.' >&2; exit 1; }
 fi
done
marker=false
if [ -e /etc/gstd-node-https/bootstrap.json ] || [ -L /etc/gstd-node-https/bootstrap.json ]; then
 target=/etc/gstd-node-https/bootstrap.json
 [ ! -L "$target" ] && [ -f "$target" ] && [ "$(stat -c %u "$target")" -eq 0 ] && [ $((8#$(stat -c %a "$target") & 022)) -eq 0 ] || { echo 'Unsafe bootstrap marker.' >&2; exit 1; }
 /usr/bin/python3 -I -c 'import json,sys; d=json.load(open("/etc/gstd-node-https/bootstrap.json")); assert d=={"uid":int(sys.argv[1]),"port":int(sys.argv[2])}, "Existing HTTPS helper belongs to another user/port"' "$operator_uid" "$port"
 marker=true
fi
for target in /etc/systemd/system/gstd-node-https.service /etc/systemd/system/gstd-node-https.socket /etc/systemd/system/gstd-node-https-control.service /etc/gstd-node-https/Caddyfile; do
 [ ! -L "$target" ] || { echo 'Refusing a managed symlink.' >&2; exit 1; }
 if [ -e "$target" ]; then
  [ "$marker" = true ] && [ -f "$target" ] && [ "$(stat -c %u "$target")" -eq 0 ] && [ $((8#$(stat -c %a "$target") & 022)) -eq 0 ] || { echo 'Existing configuration is not a validated GSTD installation; no file was overwritten.' >&2; exit 1; }
 fi
done
# Use signed APT metadata and its SHA256, extracting only the binary. No package
# maintainer script or stock caddy.service is executed, enabled or overwritten.
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends python3 ca-certificates
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
chmod 755 "$work"
candidate="$(apt-cache policy caddy | awk '/Candidate:/ {print $2; exit}')"
[ -n "$candidate" ] && [ "$candidate" != '(none)' ] || { echo 'No Caddy package in the configured trusted APT sources.' >&2; exit 1; }
expected="$(apt-cache show "caddy=$candidate" | awk '/^SHA256:/ {print $2; exit}')"
[[ "$expected" =~ ^[a-f0-9]{64}$ ]] || { echo 'Missing trusted Caddy checksum.' >&2; exit 1; }
(cd "$work" && apt-get download "caddy=$candidate")
shopt -s nullglob
archives=("$work"/caddy_*.deb)
[ "${#archives[@]}" -eq 1 ] || { echo 'Unexpected package download.' >&2; exit 1; }
printf '%s  %s\n' "$expected" "${archives[0]}" | sha256sum -c -
dpkg-deb --extract "${archives[0]}" "$work/unpacked"
[ -f "$work/unpacked/usr/bin/caddy" ] && [ ! -L "$work/unpacked/usr/bin/caddy" ] || { echo 'Caddy binary is missing.' >&2; exit 1; }
if ! id gstd-node-https >/dev/null 2>&1; then useradd --system --user-group --home-dir /var/lib/gstd-node-https --shell /usr/sbin/nologin gstd-node-https; fi
[ "$(id -u gstd-node-https)" -gt 0 ] && [ "$(id -u gstd-node-https)" -lt 1000 ] && [ "$(id -u gstd-node-https)" -ne "$operator_uid" ] || { echo 'Unsafe managed service identity.' >&2; exit 1; }
/usr/bin/python3 -I -c 'import os,pathlib; p=pathlib.Path("/usr/local/lib"); assert all(x.stat().st_uid==0 and not (x.stat().st_mode & 0o022) for x in [p,*p.parents]), "Unsafe library parent directory"'
# Existing managed paths must not point into node-writable locations.
for target in /etc/gstd-node-https /etc/gstd-node-https/bootstrap.json /usr/local/lib/gstd-node-https /usr/local/lib/gstd-node-https/caddy /usr/local/lib/gstd-node-https/node-https-helper.py /var/lib/gstd-node-https /var/lib/gstd-node-https/admin /var/lib/gstd-node-https/data /var/lib/gstd-node-https/config /etc/systemd/system/gstd-node-https.service /etc/systemd/system/gstd-node-https.socket /etc/systemd/system/gstd-node-https-control.service; do
 [ ! -L "$target" ] || { echo 'Refusing a symbolic-link managed directory.' >&2; exit 1; }
done
install -d -o root -g root -m 755 /etc/gstd-node-https /usr/local/lib/gstd-node-https
install -d -o gstd-node-https -g gstd-node-https -m 700 /var/lib/gstd-node-https
# Never root-chown descendants controlled by the proxy user (symlink races).
/usr/sbin/runuser -u gstd-node-https -- /usr/bin/python3 -I -c 'import os,pathlib; base=pathlib.Path("/var/lib/gstd-node-https");
for name in ("admin","data","config"):
 p=base/name
 assert not p.is_symlink(), "Unsafe proxy data path"
 p.mkdir(mode=0o700,exist_ok=True)
 assert p.is_dir() and p.stat().st_uid==os.getuid(), "Unsafe proxy data owner"
 p.chmod(0o700)'
install -o root -g root -m 755 "$work/unpacked/usr/bin/caddy" /usr/local/lib/gstd-node-https/caddy
install -o root -g root -m 644 "$source_dir/node-https-helper.py" /usr/local/lib/gstd-node-https/node-https-helper.py
/usr/bin/python3 -I -c 'import json,os,pathlib,sys,tempfile; root=pathlib.Path("/etc/gstd-node-https"); fd,tmp=tempfile.mkstemp(dir=root); os.fchmod(fd,0o600); os.write(fd,json.dumps({"uid":int(sys.argv[1]),"port":int(sys.argv[2])}).encode()); os.close(fd); os.replace(tmp,root/"bootstrap.json")' "$operator_uid" "$port"
cat > /etc/systemd/system/gstd-node-https.socket <<EOF
[Unit]
Description=GSTD operator HTTPS control socket
[Socket]
ListenStream=/run/gstd-node-https/control.sock
SocketUser=$operator
SocketMode=0600
DirectoryMode=0755
RemoveOnStop=yes
[Install]
WantedBy=sockets.target
EOF
cat > /etc/systemd/system/gstd-node-https.service <<'EOF'
[Unit]
Description=GSTD managed Let’s Encrypt HTTPS proxy
After=network-online.target
Wants=network-online.target
ConditionPathExists=/etc/gstd-node-https/Caddyfile
[Service]
User=gstd-node-https
Group=gstd-node-https
WorkingDirectory=/var/lib/gstd-node-https
Environment=HOME=/var/lib/gstd-node-https
Environment=XDG_DATA_HOME=/var/lib/gstd-node-https/data
Environment=XDG_CONFIG_HOME=/var/lib/gstd-node-https/config
ExecStart=/usr/local/lib/gstd-node-https/caddy run --config /etc/gstd-node-https/Caddyfile --adapter caddyfile
ExecReload=/usr/local/lib/gstd-node-https/caddy reload --address unix//var/lib/gstd-node-https/admin/caddy.sock --config /etc/gstd-node-https/Caddyfile --adapter caddyfile
Restart=on-failure
RestartSec=5
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/gstd-node-https
PrivateTmp=true
UMask=0077
[Install]
WantedBy=multi-user.target
EOF
cat > /etc/systemd/system/gstd-node-https-control.service <<'EOF'
[Unit]
Description=GSTD narrowly scoped HTTPS control service
Requires=gstd-node-https.socket
After=gstd-node-https.socket
[Service]
Sockets=gstd-node-https.socket
ExecStart=/usr/bin/python3 -I /usr/local/lib/gstd-node-https/node-https-helper.py
User=root
Group=root
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/etc/gstd-node-https /var/lib/gstd-node-https /etc/systemd/system/multi-user.target.wants
PrivateTmp=true
UMask=0077
TimeoutStopSec=10
Restart=on-failure
RestartSec=5
EOF
# Socket activation names the matching service explicitly.
sed -i '/\[Socket\]/a Service=gstd-node-https-control.service' /etc/systemd/system/gstd-node-https.socket
chmod 644 /etc/systemd/system/gstd-node-https*.service /etc/systemd/system/gstd-node-https.socket
systemctl daemon-reload
systemctl enable --now gstd-node-https.socket
systemctl try-restart gstd-node-https-control.service
echo 'HTTPS helper installed. No certificate was requested and no public HTTPS proxy was started.'
echo 'Open the authenticated node panel, enter your domain/email, review the two consent checkboxes, and submit.'
echo 'DNS and public challenge ports must already route to this machine; existing firewalls and proxies were not changed.'
