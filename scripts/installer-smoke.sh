#!/usr/bin/env bash
# Run only inside a disposable CI container, never on an operator machine.
set -euo pipefail
[ "${GSTD_INSTALLER_SMOKE:-}" = 1 ] || { echo 'Disposable container opt-in required'; exit 2; }
export HOME=/tmp/gstd-fresh-home GSTD_INSTALL_DIR=/tmp/gstd-fresh-node NODE_ENV=production
export GSTD_MODE=platform GSTD_SWARM_URL=http://127.0.0.1:9 OLLAMA_URL=http://127.0.0.1:9
mkdir -p "$HOME"
# Exercise the source installer without downloading a multi-GB inference runtime.
# Actual Ollama/model compatibility is a separate acceptance test.
cat > /usr/local/bin/ollama <<'RUNTIME'
#!/usr/bin/env bash
case "${1:-}" in
 --version) echo 'CI fixture; no inference runtime';;
 list) echo 'NAME ID SIZE';;
 *) exit 0;;
esac
RUNTIME
chmod +x /usr/local/bin/ollama
bash /source/install.sh --no-model > /tmp/source-installer.log 2>&1 || { tail -60 /tmp/source-installer.log; exit 1; }
test "$(git -C "$GSTD_INSTALL_DIR" rev-parse HEAD)" = "$GSTD_INSTALL_REF"
test -x "$GSTD_INSTALL_DIR/node_modules/.bin/tsc"
test -f "$GSTD_INSTALL_DIR/dist/index.js"
gstd-node status
bash "$GSTD_INSTALL_DIR/scripts/install.sh" --check
node <<'NODE'
const fs=require('fs'),assert=require('assert/strict');
(async()=>{
 const base='http://127.0.0.1:8080';
 const health=await fetch(base+'/health');assert.equal(health.status,200);
 const file=process.env.HOME+'/.config/gstdbot/setup-token';
 assert.equal(fs.statSync(file).mode&0o777,0o600);
 const setupToken=fs.readFileSync(file,'utf8').trim();
 const first=await fetch(base+'/api/auth/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin:'95317428',setupToken})});
 assert.equal(first.status,200);const {token}=await first.json();
 const catalog=await fetch(base+'/api/ollama/catalog',{headers:{Authorization:'Bearer '+token}});
 assert.equal(catalog.status,200);assert((await catalog.json()).models.length>0);
 // Root/container installs must remain healthy without installing a host HTTPS controller.
 const https=await fetch(base+'/api/node/https/status',{headers:{Authorization:'Bearer '+token}});
 assert.equal(https.status,200);assert.equal((await https.json()).helperInstalled,false);
 assert.equal(fs.existsSync('/etc/gstd-node-https/bootstrap.json'),false);
 console.log('Fresh pinned GitHub install, production-environment build, compatibility entry point, first login and packaged catalog passed. No model inference tested.');
})().catch(e=>{console.error(e.message);process.exit(1)});
NODE
