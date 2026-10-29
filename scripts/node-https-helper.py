#!/usr/bin/python3
"""Root-owned, socket-activated HTTPS control plane. Never execute from a writable checkout."""
import datetime
import grp
import ipaddress
import http.client
import json
import os
import pathlib
import re
import socket
import ssl
import struct
import sys
import subprocess
import tempfile
import threading
import time

ROOT = pathlib.Path("/etc/gstd-node-https")
LIB = pathlib.Path("/usr/local/lib/gstd-node-https")
DATA = pathlib.Path("/var/lib/gstd-node-https")
SERVICE = "gstd-node-https.service"
CA = "https://acme-v02.api.letsencrypt.org/directory"
PRIVATE = (".local", ".localhost", ".internal", ".lan", ".home", ".corp", ".intranet", ".localdomain")
DOMAIN = re.compile(r"(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$")
EMAIL = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$")
MAX_REQUEST = 4096

def validate(body):
    if not isinstance(body, dict) or set(body) != {"action", "domain", "email", "agreeTerms", "exposePublic"}:
        raise ValueError("invalid_request")
    domain, email = body["domain"], body["email"]
    if not isinstance(domain, str) or not DOMAIN.fullmatch(domain.lower()) or domain != domain.strip():
        raise ValueError("invalid_domain")
    domain = domain.lower()
    if domain.endswith(PRIVATE) or domain == "localhost":
        raise ValueError("invalid_domain")
    if not isinstance(email, str) or len(email) > 254 or not EMAIL.fullmatch(email):
        raise ValueError("invalid_email")
    if body["action"] != "configure" or body["agreeTerms"] is not True or body["exposePublic"] is not True:
        raise ValueError("consent_required")
    return domain, email

def resolve_public(domain):
    resolved = subprocess.run(["/usr/bin/python3", "-I", "-c",
        "import socket,json,sys;print(json.dumps(list({x[4][0] for x in socket.getaddrinfo(sys.argv[1],443,type=socket.SOCK_STREAM)})))", domain],
        capture_output=True, text=True, timeout=5, check=True)
    addresses = set(json.loads(resolved.stdout))
    if not addresses or any(not ipaddress.ip_address(ip).is_global for ip in addresses):
        raise ValueError("domain_not_public")
    return addresses

def verify_local_tls(domain):
    # Fixed loopback destination: a domain can never redirect this probe to another host.
    context = ssl.create_default_context()
    with socket.create_connection(("127.0.0.1", 443), timeout=3) as raw:
        with context.wrap_socket(raw, server_hostname=domain) as tls:
            cert = tls.getpeercert()
            tls.sendall(("GET /health HTTP/1.1\r\nHost: "+domain+"\r\nConnection: close\r\n\r\n").encode("ascii"))
            response = http.client.HTTPResponse(tls)
            try:
                response.begin()
                raw = response.read(8193)
            except http.client.HTTPException:
                raise ValueError("gateway_health_failed") from None
            if response.status != 200 or len(raw) > 8192:
                raise ValueError("gateway_health_failed")
            try:
                health = json.loads(raw)
                if not isinstance(health,dict) or health.get("status") != "ok" or health.get("security",{}).get("pinAuth") is not True:
                    raise ValueError("gateway_health_failed")
            except (ValueError, TypeError, RecursionError, AttributeError):
                raise ValueError("gateway_health_failed") from None
    issuer = " ".join(value for row in cert.get("issuer", ()) for key, value in row)
    if "let's encrypt" not in issuer.lower():
        raise ValueError("issuer_not_letsencrypt")
    expiry = ssl.cert_time_to_seconds(cert["notAfter"])
    if expiry <= time.time() + 86400:
        raise ValueError("certificate_expiring")
    return datetime.datetime.fromtimestamp(expiry, datetime.timezone.utc).isoformat()

def bounded_tls_probe(domain):
    # A hard subprocess deadline also covers slow/truncated local HTTP headers.
    try:
        result = subprocess.run(["/usr/bin/python3", "-I", str(LIB / "node-https-helper.py"), "--tls-probe", domain],
            capture_output=True, text=True, check=True, timeout=6)
        expiry = json.loads(result.stdout)
        if not isinstance(expiry,str) or len(expiry)>64:
            raise ValueError("tls_not_verified")
        return expiry
    except (OSError, ValueError, subprocess.SubprocessError):
        raise ValueError("tls_not_verified") from None

def render_config(domain, email, port):
    # Inputs are validated again at the root boundary, never interpolated into a shell.
    validate({"action":"configure", "domain":domain, "email":email, "agreeTerms":True, "exposePublic":True})
    if not isinstance(port, int) or isinstance(port, bool) or port < 1024 or port > 65535 or port in (2019,):
        raise ValueError("invalid_upstream")
    return ("{\n admin unix//var/lib/gstd-node-https/admin/caddy.sock\n}\n"
        + domain + " {\n tls {\n  issuer acme {\n   dir " + CA
        + "\n   email " + email + "\n  }\n }\n reverse_proxy 127.0.0.1:" + str(port) + "\n}\n")

def command(args, timeout=30):
    return subprocess.run(args, check=True, timeout=timeout, stdin=subprocess.DEVNULL,
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                          env={"PATH":"/usr/sbin:/usr/bin:/sbin:/bin", "HOME":str(DATA),
                               "XDG_DATA_HOME":str(DATA / "data"), "XDG_CONFIG_HOME":str(DATA / "config")})

def atomic_write(path, text, mode=0o600, group=None):
    fd, temporary = tempfile.mkstemp(prefix=".https-", dir=path.parent)
    try:
        if group is not None and os.geteuid() == 0:
            os.fchown(fd, -1, grp.getgrnam(group).gr_gid)
        os.fchmod(fd, mode)
        with os.fdopen(fd, "w") as stream:
            stream.write(text)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)

class Manager:
    def __init__(self, config, root=ROOT, runner=command, resolver=resolve_public, probe=bounded_tls_probe, wait=time.sleep):
        self.config, self.root, self.run = config, pathlib.Path(root), runner
        self.resolve, self.probe, self.wait = resolver, probe, wait
        self.lock = threading.Lock()
        self.worker = None
        self.state = {"state":"not_configured", "verified":False, "externalVerified":False, "renewal":"caddy"}
        self.last_check = 0.0
        try:
            saved = json.loads((self.root / "status.json").read_text())
            # Persisted status contains no key material, email, command output or certificate paths.
            if isinstance(saved, dict) and isinstance(saved.get("domain"), str):
                self.state = {**self.state, **{k:saved[k] for k in ("domain","expires","verifiedAt","retryAfterEpoch") if k in saved}, "state":"verification_required"}
                if saved.get("state") == "configuring":
                    self.state["state"] = "configuring"
                    self.worker = threading.Thread(target=self.recover, args=(saved,), daemon=True)
                    self.worker.start()
        except (OSError, ValueError):
            pass

    def recover(self, saved):
        # No new issuance job is created after a controller crash or reboot.
        target, backup = self.root / "Caddyfile", self.root / "previous-Caddyfile"
        domain = saved.get("domain", "")
        try:
            if not DOMAIN.fullmatch(domain) or not target.is_file() or not self.active():
                raise ValueError("pending_setup_interrupted")
            expiry = self.probe(domain)
            self.run(["/usr/bin/systemctl", "enable", SERVICE], 15)
            with self.lock:
                self.state.update(state="verified",verified=True,expires=expiry,
                    verifiedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),error=None)
                self.persist()
            backup.unlink(missing_ok=True)
            return
        except (OSError, ValueError, ssl.SSLError, subprocess.SubprocessError):
            pass
        error = "pending_setup_interrupted"
        try:
            if saved.get("hadPrevious") is True and backup.is_file():
                previous = backup.read_text()
                changed = not target.is_file() or target.read_text() != previous
                atomic_write(target,previous,0o640,"gstd-node-https")
                if saved.get("previousActive") is True:
                    active = self.active()
                    if changed or not active:
                        self.run(["/usr/bin/systemctl","reload" if active else "start",SERVICE],30)
                else:
                    self.run(["/usr/bin/systemctl","stop",SERVICE],30)
            else:
                self.run(["/usr/bin/systemctl","stop",SERVICE],30)
                target.unlink(missing_ok=True)
        except (OSError, UnicodeError, subprocess.SubprocessError):
            error = "rollback_failed"
        with self.lock:
            self.state.update(state="failed",verified=False,error=error)
            self.persist()

    def active(self):
        try:
            self.run(["/usr/bin/systemctl", "is-active", "--quiet", SERVICE], 5)
            return True
        except (OSError, subprocess.SubprocessError):
            return False

    def persist(self):
        atomic_write(self.root / "status.json", json.dumps(self.state))

    def preflight(self, domain):
        self.resolve(domain)
        for service in ("caddy.service", "nginx.service", "apache2.service", "haproxy.service"):
            try:
                self.run(["/usr/bin/systemctl", "is-active", "--quiet", service], 5)
            except (OSError, subprocess.SubprocessError):
                continue
            raise ValueError("existing_proxy")
        if not self.active():
            for port in (80, 443):
                listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                try:
                    listener.bind(("0.0.0.0", port))
                except OSError:
                    raise ValueError("ports_in_use") from None
                finally:
                    listener.close()

    def status(self):
        with self.lock:
            state = dict(self.state)
            running = self.worker is not None and self.worker.is_alive()
        if state.get("domain") and not running and time.monotonic() - self.last_check >= 30:
            self.last_check = time.monotonic()
            try:
                if not (self.root / "Caddyfile").is_file() or not self.active():
                    raise ValueError("managed_service_inactive")
                expiry = self.probe(state["domain"])
                state.update(state="verified", verified=True, expires=expiry,
                             verifiedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(), error=None)
            except (OSError, ValueError, ssl.SSLError):
                state.update(state="verification_required", verified=False, error="tls_not_verified")
            with self.lock:
                self.state = state
        return {**state, "helperInstalled":True, "externalVerified":False, "renewal":"caddy", "upstreamPort":self.config["port"]}

    def start(self, body):
        domain, email = validate(body)
        target = self.root / "Caddyfile"
        if target.exists():
            hosts = re.findall(r"^([a-z0-9.-]+) \{$", target.read_text(), re.MULTILINE)
            if hosts != [domain]:
                raise ValueError("domain_change_requires_manual")
        with self.lock:
            if self.worker is not None and self.worker.is_alive():
                raise ValueError("https_busy")
            # Cap production issuance attempts even if a caller repeatedly presses the button.
            if time.time() < self.state.get("retryAfterEpoch", 0):
                raise ValueError("https_cooldown")
            previous_state = dict(self.state)
            had_previous, previous_active = target.exists(), self.active()
            if had_previous:
                atomic_write(self.root / "previous-Caddyfile",target.read_text())
            self.state = {"state":"configuring", "domain":domain, "verified":False,
                          "hadPrevious":had_previous, "previousActive":previous_active,
                          "externalVerified":False, "renewal":"caddy", "retryAfterEpoch":time.time()+600}
            self.persist()
            self.worker = threading.Thread(target=self.configure, args=(domain,email,previous_state), daemon=True)
            self.worker.start()
        return {**self.state, "upstreamPort":self.config["port"]}

    def configure(self, domain, email, previous_state=None):
        target = self.root / "Caddyfile"
        previous, previous_active, mutated = None, False, False
        error = "https_setup_failed"
        deadline = time.monotonic() + 120
        try:
            previous = target.read_text() if target.exists() else None
            previous_active = self.active()
            self.preflight(domain)
            text = render_config(domain, email, self.config["port"])
            atomic_write(target, text, 0o640,"gstd-node-https")
            mutated = True
            self.run(["/usr/sbin/runuser", "-u", "gstd-node-https", "--", str(LIB / "caddy"),
                      "validate", "--config", str(target), "--adapter", "caddyfile"], 20)
            self.run(["/usr/bin/systemctl", "reload" if previous_active else "start", SERVICE], 30)
            for attempt in range(24):
                if time.monotonic() >= deadline:
                    break
                try:
                    expiry = self.probe(domain)
                    self.run(["/usr/bin/systemctl", "enable", SERVICE], 15)
                    with self.lock:
                        self.state.update(state="verified", verified=True, expires=expiry,
                            verifiedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(), error=None)
                        self.persist()
                    (self.root / "previous-Caddyfile").unlink(missing_ok=True)
                    return
                except (OSError, ValueError, ssl.SSLError):
                    if attempt < 23:
                        self.wait(max(0, min(5, deadline-time.monotonic())))
            error = "certificate_validation_failed"
        except ValueError as exc:
            error = str(exc) if str(exc) in ("domain_not_public","existing_proxy","ports_in_use","invalid_upstream") else "https_setup_failed"
        except (OSError, UnicodeError, subprocess.SubprocessError):
            error = "https_setup_failed"
        # Never leave a failed first setup retrying ACME in the background.
        try:
            if mutated and previous is not None:
                atomic_write(target, previous, 0o640,"gstd-node-https")
                if previous_active:
                    self.run(["/usr/bin/systemctl", "reload" if self.active() else "start", SERVICE], 30)
                else:
                    self.run(["/usr/bin/systemctl", "stop", SERVICE], 30)
            elif mutated:
                self.run(["/usr/bin/systemctl", "stop", SERVICE], 30)
                target.unlink(missing_ok=True)
        except (OSError, subprocess.SubprocessError):
            error = "rollback_failed"
        with self.lock:
            retry_after = self.state.get("retryAfterEpoch", time.time()+600)
            if previous_state and previous_state.get("domain") and previous is not None:
                self.state = {**previous_state, "state":"verification_required", "verified":False,
                              "error":error, "lastAttemptError":error, "attemptDomain":domain, "retryAfterEpoch":retry_after}
            else:
                self.state.update(state="failed", verified=False, error=error)
            self.persist()

def read_config():
    path = ROOT / "bootstrap.json"
    for item in (ROOT, path, LIB, LIB / "node-https-helper.py", LIB / "caddy"):
        st = item.stat()
        if item.is_symlink() or st.st_uid != 0 or st.st_mode & 0o022:
            raise RuntimeError("unsafe_helper_install")
    data = json.loads(path.read_text())
    if set(data) != {"uid", "port"} or type(data["uid"]) is not int or data["uid"] <= 0:
        raise RuntimeError("invalid_bootstrap")
    render_config("bootstrap.example.org", "bootstrap@example.org", data["port"])
    return data

def receive(connection, expected_uid, manager):
    connection.settimeout(5)
    peer = struct.unpack("3i", connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
    if peer[1] != expected_uid:
        return {"error":"access_denied"}
    raw = b""
    deadline = time.monotonic() + 5
    while not raw.endswith(b"\n"):
        remaining = deadline-time.monotonic()
        if remaining <= 0:
            return {"error":"invalid_request"}
        connection.settimeout(remaining)
        part = connection.recv(min(1024, MAX_REQUEST + 1 - len(raw)))
        if not part:
            break
        raw += part
        if len(raw) > MAX_REQUEST:
            return {"error":"request_too_large"}
    try:
        body = json.loads(raw)
        if body == {"action":"status"}:
            return manager.status()
        return manager.start(body)
    except ValueError as exc:
        code = str(exc)
        return {"error":code if code in {"invalid_request","invalid_domain","invalid_email","consent_required","https_busy","https_cooldown","domain_change_requires_manual"} else "invalid_request"}
    except (TypeError, RecursionError):
        return {"error":"invalid_request"}

def main():
    if os.geteuid() != 0 or os.environ.get("LISTEN_PID") != str(os.getpid()) or os.environ.get("LISTEN_FDS") != "1":
        raise SystemExit("Socket-activated root service required.")
    config = read_config()
    manager = Manager(config)
    server = socket.socket(fileno=3)
    while True:
        connection, _ = server.accept()
        with connection:
            try:
                response = receive(connection, config["uid"], manager)
            except (OSError, ValueError, TypeError, RecursionError):
                response = {"error":"invalid_request"}
            try:
                connection.sendall(json.dumps(response).encode() + b"\n")
            except OSError:
                pass

if __name__ == "__main__":
    if len(sys.argv)==3 and sys.argv[1]=="--tls-probe":
        try:
            domain,_ = validate({"action":"configure","domain":sys.argv[2],"email":"probe@example.org","agreeTerms":True,"exposePublic":True})
            print(json.dumps(verify_local_tls(domain)))
        except (OSError, ValueError, ssl.SSLError, http.client.HTTPException):
            raise SystemExit(1)
    elif len(sys.argv)==1:
        main()
    else:
        raise SystemExit("Unsupported helper arguments.")
