# Dashboard Reliability Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 22 field-name/route mismatch bugs (plus a few newly-discovered ones found while writing this plan) that disconnect `web/dashboard.html`'s UI from otherwise-working backend capabilities in `src/gateway/server.ts` and related files.

**Architecture:** No new infrastructure. Each task fixes one dashboard tab's JavaScript to read the field names/routes its backend actually uses, or (in a few cases) adds one small, well-precedented backend field/route where the frontend expects something that never existed server-side. Tasks are organized by tab to avoid overlapping edits to the same regions of `web/dashboard.html`.

**Tech Stack:** TypeScript (Node.js 20) for `server.ts`; plain browser JavaScript embedded in `web/dashboard.html`. This repo has vitest (`npm test`) but no existing coverage pattern for the dashboard's inline JS — verification there is grep-based sanity checks plus live `curl` checks against the running node, matching the pattern already established in the prior "honest-features-fix" and "resilience-fix" sub-projects this session.

## Global Constraints

- Do not fabricate data for a UI element with no real backing data source — either wire it to genuinely available data, or remove the element (matches the spec's explicit "Reward Rate" and "stake row" decisions).
- Every backend field/route addition must follow this file's existing patterns exactly (e.g., `requireNodeAuth(req, res)` for authenticated routes, `hashPin`/`createAuthToken` for PIN handling) — do not invent a new auth or hashing scheme.
- Repo root for all paths below: `/home/bot/gstdbot/`.

---

### Task 1: Home tab + shared `/api/node/status` node-identity fields

**Files:**
- Modify: `src/gateway/server.ts` (the `/api/node/status` handler, `node: {...}` object)
- Modify: `web/dashboard.html` (`refreshHome()`, lines 1023-1095)

**Interfaces:**
- Produces: `/api/node/status`'s `node` object gains a `nodeId` field (string). Task 6 (Settings tab) also consumes this same field — both tasks read `d.node.nodeId`, not a top-level `d.nodeId`.

- [ ] **Step 1: Add `nodeId` to the `/api/node/status` handler's `node` object**

Find in `src/gateway/server.ts` (inside the `GatewayServer` class, which already has a `private nodeId: string` field populated at construction — see line 258: `this.nodeId = process.env.GSTD_NODE_ID || \`gstd-${hostname()}-${process.pid}\`;`):

```ts
                node: {
                    name: process.env.NODE_NAME || hostname(),
                    platform: platform(), arch: arch(),
                    uptime: process.uptime(), os_uptime: osUptime(),
                    version: require('../../package.json').version,
                    started_at: new Date(nodeStartedAt).toISOString(),
                    ip: getLocalIP(), pid: process.pid,
                },
```

Replace it with:

```ts
                node: {
                    name: process.env.NODE_NAME || hostname(),
                    nodeId: this.nodeId,
                    platform: platform(), arch: arch(),
                    uptime: process.uptime(), os_uptime: osUptime(),
                    version: require('../../package.json').version,
                    started_at: new Date(nodeStartedAt).toISOString(),
                    ip: getLocalIP(), pid: process.pid,
                },
```

- [ ] **Step 2: Fix `refreshHome()`'s node-identity block in `web/dashboard.html`**

Find (lines 1079-1084):

```js
  try {
    const s=await api('/api/node/status').then(r=>r.json());
    set('h-name',s.name||'GSTD Node');
    set('h-sub','v'+(s.version||'—')+' · '+(s.platform||''));
    set('sb-node-id',trunc(s.nodeId||'',10,6));
  } catch(e){}
```

Replace it with:

```js
  try {
    const s=await api('/api/node/status').then(r=>r.json());
    set('h-name',s.node?.name||'GSTD Node');
    set('h-sub','v'+(s.node?.version||'—')+' · '+(s.node?.platform||''));
    set('sb-node-id',trunc(s.node?.nodeId||'',10,6));
  } catch(e){}
```

- [ ] **Step 3: Fix `refreshHome()`'s storage (IPFS pins/peers) fields**

Find (lines 1064-1069):

```js
  if(ipfs.status==='fulfilled'){
    const d=ipfs.value;
    set('h-pins',d.pins?.length||0);
    set('h-peers',d.peers||0);
    set('h-ipfs-id',trunc(d.peer_id||'',8,4));
  }
```

Replace it with:

```js
  if(ipfs.status==='fulfilled'){
    const d=ipfs.value;
    set('h-pins',d.pin_list?.length||0);
    set('h-peers',d.ipfs_peers||0);
    set('h-ipfs-id',trunc(d.peer_id||'',8,4));
  }
```

(`GET /api/storage` returns `pins` as a plain count and the actual pin array under `pin_list`, and the peer-count field is named `ipfs_peers`, not `peers` — confirmed at `src/gateway/server.ts:656-674`.)

- [ ] **Step 4: Fix `refreshHome()`'s activity log field names**

Find (lines 1090-1094):

```js
    el.innerHTML=ents.slice(0,20).map(e=>{
      const t=e.timestamp?new Date(e.timestamp).toLocaleTimeString():'';
      const lv=e.level||'info';
      return `<div class="log-row"><span class="log-t">${t}</span><span class="log-l ${lv}">${lv[0].toUpperCase()}</span><span class="log-m">${esc(e.message||e.msg||'')}</span></div>`;
    }).join('');
```

Replace it with:

```js
    el.innerHTML=ents.slice(0,20).map(e=>{
      const t=e.ts?new Date(e.ts).toLocaleTimeString():'';
      const lv=e.type||'info';
      return `<div class="log-row"><span class="log-t">${t}</span><span class="log-l ${lv}">${lv[0].toUpperCase()}</span><span class="log-m">${esc(e.msg||'')}</span></div>`;
    }).join('');
```

(`logActivity()` persists entries as `{ts, msg, type}` — confirmed at `src/gateway/server.ts:131-134`.)

- [ ] **Step 5: Verify TypeScript compiles**

Run: `cd /home/bot/gstdbot && npx tsc --skipLibCheck`
Expected: no errors.

- [ ] **Step 6: Verify against the running node**

```bash
curl -s http://localhost:8080/api/node/status | python3 -c "import json,sys; d=json.load(sys.stdin); assert 'nodeId' in d['node'], 'nodeId missing from node object'; print('OK:', d['node']['nodeId'])"
curl -s http://localhost:8080/api/storage | python3 -c "import json,sys; d=json.load(sys.stdin); print('ipfs_peers' in d, 'pin_list' in d)"
```
Expected: first command prints `OK: <some id>`; second prints `True True` (or the daemon-disabled shape `{enabled: false, ...}` if IPFS isn't running locally — in that case just confirm no error).

- [ ] **Step 7: Commit**

```bash
cd /home/bot/gstdbot
git add src/gateway/server.ts web/dashboard.html
git commit -m "fix: Home tab field mismatches (node identity, storage stats, activity log)"
```

---

### Task 2: Models tab — installed-list, catalog, Install/Remove buttons

**Files:**
- Modify: `web/dashboard.html` (`loadModels()`, the local `CATALOG` array, `renderCatalog()`, `executePull()`, `removeModel()` — lines 1109-1223)

**Interfaces:** None — self-contained within this tab. Consumes `GET /api/ollama/models` (`{installed: [{id,size,modified_at,details}], running, catalog: [{id,name,size_gb,desc,family,tier,installed}], ollama_available}` — confirmed at `src/gateway/server.ts:4068-4082`), `POST /api/ollama/models/pull` (SSE stream), `DELETE /api/ollama/models/:name`.

- [ ] **Step 1: Fix `loadModels()` to read `installed`, not `models`, and use each entry's `id` field**

Find (lines 1109-1142):

```js
async function loadModels(){
  try {
    const [mods,rat,hw]=await Promise.all([
      api('/api/ollama/models').then(r=>r.json()),
      api('/api/node/rating').then(r=>r.json()),
      api('/api/node/hardware').then(r=>r.json()),
    ]);
    nodeHwRam=hw.ram?.total_gb||0;
    set('m-score',rat.score||0);
    set('m-tier','Tier: '+(rat.tier||'—'));
    set('m-mult',(rat.multiplier||1)+'×');
    const inst=mods.models||[];
    set('m-cnt',inst.length);
    const bd=rat.breakdown||{};
    const ms=bd.models?.score||0,mm=bd.models?.max||48;
    const as=bd.activity?.score||0,am=bd.activity?.max||32;
    const us=bd.uptime?.score||0,um=bd.uptime?.max||20;
    const rb=id=>document.getElementById(id);
    rb('rb-mb').style.width=(ms/mm*100)+'%'; set('rb-mv',ms+'/'+mm);
    rb('rb-ab').style.width=(as/am*100)+'%'; set('rb-av',as+'/'+am);
    rb('rb-ub').style.width=(us/um*100)+'%'; set('rb-uv',us+'/'+um);
    set('m-cpu',(hw.cpu?.model||'Unknown').slice(0,30));
    set('m-ram',(hw.ram?.total_gb||0)+' GB');
    set('m-disk',(hw.disk?.free_gb||0)+' GB free');
    const names=inst.map(m=>m.name||m.model||m);
    const listEl=document.getElementById('m-list');
    if(!inst.length){listEl.innerHTML='<div class="empty"><div class="ei">&#x1F916;</div><h4>No models installed</h4><p>Pull a model below to get started</p></div>';}
    else {
      listEl.innerHTML='<table class="tbl"><thead><tr><th>Model</th><th>Size</th><th>Modified</th><th></th></tr></thead><tbody>'+
        inst.map(m=>`<tr><td class="mono tc sm">${esc(m.name||m.model||m)}</td><td>${m.size?(m.size/1e9).toFixed(2)+' GB':'—'}</td><td>${m.modified_at?new Date(m.modified_at).toLocaleDateString():'—'}</td><td><button class="btn btn-danger btn-sm" onclick="removeModel('${esc(m.name||m.model||m)}')">Remove</button></td></tr>`).join('')+
        '</tbody></table>';
    }
    renderCatalog(names,nodeHwRam);
  } catch(e){console.error('loadModels',e);}
}
```

Replace it with:

```js
async function loadModels(){
  try {
    const [mods,rat,hw]=await Promise.all([
      api('/api/ollama/models').then(r=>r.json()),
      api('/api/node/rating').then(r=>r.json()),
      api('/api/node/hardware').then(r=>r.json()),
    ]);
    nodeHwRam=hw.ram?.total_gb||0;
    set('m-score',rat.score||0);
    set('m-tier','Tier: '+(rat.tier||'—'));
    set('m-mult',(rat.multiplier||1)+'×');
    const inst=mods.installed||[];
    set('m-cnt',inst.length);
    const bd=rat.breakdown||{};
    const ms=bd.models?.score||0,mm=bd.models?.max||48;
    const as=bd.activity?.score||0,am=bd.activity?.max||32;
    const us=bd.uptime?.score||0,um=bd.uptime?.max||20;
    const rb=id=>document.getElementById(id);
    rb('rb-mb').style.width=(ms/mm*100)+'%'; set('rb-mv',ms+'/'+mm);
    rb('rb-ab').style.width=(as/am*100)+'%'; set('rb-av',as+'/'+am);
    rb('rb-ub').style.width=(us/um*100)+'%'; set('rb-uv',us+'/'+um);
    set('m-cpu',(hw.cpu?.model||'Unknown').slice(0,30));
    set('m-ram',(hw.ram?.total_gb||0)+' GB');
    set('m-disk',(hw.disk?.free_gb||0)+' GB free');
    const listEl=document.getElementById('m-list');
    if(!inst.length){listEl.innerHTML='<div class="empty"><div class="ei">&#x1F916;</div><h4>No models installed</h4><p>Pull a model below to get started</p></div>';}
    else {
      listEl.innerHTML='<table class="tbl"><thead><tr><th>Model</th><th>Size</th><th>Modified</th><th></th></tr></thead><tbody>'+
        inst.map(m=>`<tr><td class="mono tc sm">${esc(m.id)}</td><td>${m.size?(m.size/1e9).toFixed(2)+' GB':'—'}</td><td>${m.modified_at?new Date(m.modified_at).toLocaleDateString():'—'}</td><td><button class="btn btn-danger btn-sm" onclick="removeModel('${esc(m.id)}')">Remove</button></td></tr>`).join('')+
        '</tbody></table>';
    }
    renderCatalog(mods.catalog||[],nodeHwRam);
  } catch(e){console.error('loadModels',e);}
}
```

- [ ] **Step 2: Delete the hardcoded local `CATALOG` array and rewrite `renderCatalog()` to use the backend's real catalog**

Find (lines 1145-1177, the local `CATALOG` array and the whole `renderCatalog` function):

```js
const CATALOG=[
  {id:'llama3.2:3b',name:'Llama 3.2 3B',desc:"Meta's compact multilingual model",size:'2.0 GB',ram:3},
  {id:'llama3.2:1b',name:'Llama 3.2 1B',desc:'Ultra-lightweight for Pi devices',size:'1.3 GB',ram:2},
  {id:'llama3.1:8b',name:'Llama 3.1 8B',desc:'Balanced performance and quality',size:'4.7 GB',ram:6},
  {id:'mistral:7b',name:'Mistral 7B',desc:'Fast European open-source model',size:'4.1 GB',ram:5},
  {id:'phi3:3.8b',name:'Phi-3 3.8B',desc:"Microsoft's compact reasoning model",size:'2.3 GB',ram:3},
  {id:'phi3:14b',name:'Phi-3 14B',desc:'Larger Phi-3 for complex tasks',size:'8.0 GB',ram:10},
  {id:'gemma2:2b',name:'Gemma 2 2B',desc:"Google's efficient small model",size:'1.6 GB',ram:2},
  {id:'gemma2:9b',name:'Gemma 2 9B',desc:"Google's mid-size instruction model",size:'5.5 GB',ram:7},
  {id:'qwen2.5:3b',name:'Qwen 2.5 3B',desc:"Alibaba's multilingual compact model",size:'1.9 GB',ram:3},
  {id:'qwen2.5:7b',name:'Qwen 2.5 7B',desc:"Alibaba's multilingual capable model",size:'4.4 GB',ram:5},
  {id:'codellama:7b',name:'CodeLlama 7B',desc:"Meta's code-specialized model",size:'3.8 GB',ram:5},
  {id:'deepseek-coder:6.7b',name:'DeepSeek Coder 6.7B',desc:'Top coding assistant model',size:'3.8 GB',ram:5},
];

function renderCatalog(inst,ram){
  document.getElementById('m-catalog').innerHTML=CATALOG.map(m=>{
    const isInst=inst.some(n=>n===m.id||n.startsWith(m.id.split(':')[0]+':'));
    const fits=ram>=m.ram;
    return `<div class="mc">
      <div class="row jb mb8"><h4>${esc(m.name)}</h4>${isInst?'<span class="badge badge-green">Installed</span>':fits?'<span class="badge badge-accent">Fits</span>':'<span class="badge badge-yellow">Low RAM</span>'}</div>
      <p>${esc(m.desc)}</p>
      <div class="row gap8 mb8">
        <span class="badge badge-muted">&#x1F4BE; ${m.size}</span>
        <span class="badge badge-muted">&#x1F9E0; ${m.ram}GB RAM</span>
      </div>
      ${isInst
        ?`<button class="btn btn-danger btn-sm" onclick="removeModel('${m.id}')">Remove</button>`
        :`<button class="btn btn-primary btn-sm" onclick="startPull('${m.id}')" ${fits?'':'style="opacity:0.6"'}>&#x2B07; Install</button>`
      }
    </div>`;
  }).join('');
}
```

Replace it with (no local array — `renderCatalog` now takes the backend's real catalog, which already includes an `installed` boolean per entry, and uses `size_gb` as a RAM-fit heuristic since the backend catalog doesn't carry a separate minimum-RAM field):

```js
function renderCatalog(catalog,ram){
  document.getElementById('m-catalog').innerHTML=catalog.map(m=>{
    const fits=ram>=m.size_gb;
    return `<div class="mc">
      <div class="row jb mb8"><h4>${esc(m.name)}</h4>${m.installed?'<span class="badge badge-green">Installed</span>':fits?'<span class="badge badge-accent">Fits</span>':'<span class="badge badge-yellow">Low RAM</span>'}</div>
      <p>${esc(m.desc)}</p>
      <div class="row gap8 mb8">
        <span class="badge badge-muted">&#x1F4BE; ${m.size_gb} GB</span>
        <span class="badge badge-muted">&#x1F9E0; ~${m.size_gb} GB RAM</span>
      </div>
      ${m.installed
        ?`<button class="btn btn-danger btn-sm" onclick="removeModel('${esc(m.id)}')">Remove</button>`
        :`<button class="btn btn-primary btn-sm" onclick="startPull('${esc(m.id)}')" ${fits?'':'style="opacity:0.6"'}>&#x2B07; Install</button>`
      }
    </div>`;
  }).join('');
}
```

- [ ] **Step 3: Fix the Install button's URL and SSE response parsing in `executePull()`**

Find (lines 1192-1212):

```js
async function executePull(name){
  const logEl=document.getElementById('pull-log');
  pullCtrl=new AbortController();
  try {
    const r=await fetch(API+'/api/ollama/pull',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+tok},body:JSON.stringify({model:name}),signal:pullCtrl.signal});
    if(!r.ok){const e=await r.json();logEl.textContent+='Error: '+(e.error||r.status)+'\n';return;}
    const reader=r.body.getReader(),dec=new TextDecoder();
    while(true){
      const {done,value}=await reader.read();
      if(done) break;
      const txt=dec.decode(value);
      for(const line of txt.split('\n').filter(Boolean)){
        try{const j=JSON.parse(line);if(j.status) logEl.textContent+=j.status+'\n';if(j.completed&&j.total) logEl.textContent+='  '+Math.round(j.completed/j.total*100)+'%\n';}
        catch(_){logEl.textContent+=line+'\n';}
      }
      logEl.scrollTop=logEl.scrollHeight;
    }
    logEl.textContent+='Done!\n';
    setTimeout(()=>{cancelPull();loadModels();},1500);
  } catch(e){if(e.name!=='AbortError') logEl.textContent+='Error: '+e.message+'\n';}
}
```

Replace it with (URL fixed to `/api/ollama/models/pull`; the backend streams Server-Sent-Events lines shaped `data: {...}\n\n`, so each decoded line must have the `data: ` prefix stripped before `JSON.parse`):

```js
async function executePull(name){
  const logEl=document.getElementById('pull-log');
  pullCtrl=new AbortController();
  try {
    const r=await fetch(API+'/api/ollama/models/pull',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+tok},body:JSON.stringify({model:name}),signal:pullCtrl.signal});
    if(!r.ok){const e=await r.json();logEl.textContent+='Error: '+(e.error||r.status)+'\n';return;}
    const reader=r.body.getReader(),dec=new TextDecoder();
    while(true){
      const {done,value}=await reader.read();
      if(done) break;
      const txt=dec.decode(value);
      for(const rawLine of txt.split('\n').filter(Boolean)){
        const line=rawLine.startsWith('data: ')?rawLine.slice(6):rawLine;
        try{const j=JSON.parse(line);if(j.error){logEl.textContent+='Error: '+j.error+'\n';continue;}if(j.status) logEl.textContent+=j.status+'\n';if(j.completed&&j.total) logEl.textContent+='  '+Math.round(j.completed/j.total*100)+'%\n';}
        catch(_){logEl.textContent+=line+'\n';}
      }
      logEl.scrollTop=logEl.scrollHeight;
    }
    logEl.textContent+='Done!\n';
    setTimeout(()=>{cancelPull();loadModels();},1500);
  } catch(e){if(e.name!=='AbortError') logEl.textContent+='Error: '+e.message+'\n';}
}
```

- [ ] **Step 4: Fix the Remove button's URL in `removeModel()`**

Find (lines 1216-1223):

```js
async function removeModel(name){
  if(!confirm('Remove model "'+name+'"?')) return;
  try {
    const r=await api('/api/ollama/delete',{method:'DELETE',body:JSON.stringify({model:name})});
    if(r.ok){toast('Model removed');loadModels();}
    else{const e=await r.json();toast('Error: '+(e.error||r.status));}
  } catch(e){toast('Error: '+e.message);}
}
```

Replace it with (real route is `DELETE /api/ollama/models/:name`, name in the path, no body — confirmed at `src/gateway/server.ts:4139`):

```js
async function removeModel(name){
  if(!confirm('Remove model "'+name+'"?')) return;
  try {
    const r=await api('/api/ollama/models/'+encodeURIComponent(name),{method:'DELETE'});
    if(r.ok){toast('Model removed');loadModels();}
    else{const e=await r.json();toast('Error: '+(e.error||r.status));}
  } catch(e){toast('Error: '+e.message);}
}
```

- [ ] **Step 5: Grep sanity check**

```bash
grep -n "mods.models\|/api/ollama/pull'\|/api/ollama/delete'\|const CATALOG" web/dashboard.html
```
Expected: no matches (all four old patterns removed).

- [ ] **Step 6: Verify against the running node**

```bash
curl -s http://localhost:8080/api/ollama/models | python3 -c "
import json,sys
d=json.load(sys.stdin)
assert 'installed' in d and 'catalog' in d, 'missing keys'
print('installed:', len(d['installed']), 'catalog:', len(d['catalog']))
print('sample catalog entry:', d['catalog'][0] if d['catalog'] else None)
"
```
Expected: prints counts and one catalog entry shaped `{id, name, size_gb, desc, family, tier, installed}`.

- [ ] **Step 7: Commit**

```bash
cd /home/bot/gstdbot
git add web/dashboard.html
git commit -m "fix: Models tab -- real catalog, real installed list, working Install/Remove buttons"
```

---

### Task 3: IPFS tab — field mismatches, one crash bug, three dead buttons

**Files:**
- Modify: `web/dashboard.html` (`loadIPFS()`, `ipfsUpload()`, `ipfsFetch()`, `ipfsUnpin()` — lines 1262-1313)

**Interfaces:** None — self-contained within this tab. Consumes `GET /api/storage`, `POST /api/storage/add` (`{content, name}` → `{ok, cid, size, fee_gstd}`), `GET /api/storage/get/:cid` (raw body), `DELETE /api/storage/pin/:cid` (`{ok}`) — confirmed at `src/gateway/server.ts:656-728`.

- [ ] **Step 1: Fix `loadIPFS()` field names and the pin-list crash**

Find (lines 1262-1276):

```js
async function loadIPFS(){
  try {
    const d=await api('/api/storage').then(r=>r.json());
    set('ip-id',trunc(d.peer_id||'',12,8));
    set('ip-pins',d.pins?.length||0);
    set('ip-size',d.repo_size_mb?d.repo_size_mb.toFixed(1):'—');
    set('ip-peers',d.peers||0);
    const pins=d.pins||[];
    const el=document.getElementById('ip-list');
    if(!pins.length){el.innerHTML='<div class="empty"><div class="ei">&#x1F4CC;</div><h4>No pins yet</h4><p>Upload content above to pin it</p></div>';return;}
    el.innerHTML='<table class="tbl"><thead><tr><th>CID</th><th>Type</th><th>Actions</th></tr></thead><tbody>'+
      pins.map(p=>{const cid=p.cid||p.hash||p;return `<tr><td class="mono tc sm">${esc(cid)}</td><td><span class="badge badge-accent">${esc(p.type||'recursive')}</span></td><td class="row gap8"><button class="copy-btn" onclick="copyText('${esc(cid)}')" title="Copy">&#x1F4CB;</button><button class="btn btn-danger btn-sm" onclick="ipfsUnpin('${esc(cid)}')">Unpin</button></td></tr>`;}).join('')+
      '</tbody></table>';
  } catch(e){console.error('loadIPFS',e);}
}
```

Replace it with (`d.pins` is a count, not the array — the array is `d.pin_list`; this also fixes the crash, since `pins.map` was being called on a number whenever any pins existed):

```js
async function loadIPFS(){
  try {
    const d=await api('/api/storage').then(r=>r.json());
    set('ip-id',trunc(d.peer_id||'',12,8));
    set('ip-pins',d.pins||0);
    set('ip-size',d.repo_size_mb?d.repo_size_mb.toFixed(1):'—');
    set('ip-peers',d.ipfs_peers||0);
    const pins=d.pin_list||[];
    const el=document.getElementById('ip-list');
    if(!pins.length){el.innerHTML='<div class="empty"><div class="ei">&#x1F4CC;</div><h4>No pins yet</h4><p>Upload content above to pin it</p></div>';return;}
    el.innerHTML='<table class="tbl"><thead><tr><th>CID</th><th>Name</th><th>Actions</th></tr></thead><tbody>'+
      pins.map(p=>`<tr><td class="mono tc sm">${esc(p.cid)}</td><td class="muted sm">${esc(p.name||'—')}</td><td class="row gap8"><button class="copy-btn" onclick="copyText('${esc(p.cid)}')" title="Copy">&#x1F4CB;</button><button class="btn btn-danger btn-sm" onclick="ipfsUnpin('${esc(p.cid)}')">Unpin</button></td></tr>`).join('')+
      '</tbody></table>';
  } catch(e){console.error('loadIPFS',e);}
}
```

(Note: `pin_list` entries are `{cid, name, size_kb, pinned_at}` per `src/gateway/server.ts:670-674` — there is no `type` field, so the "Type" column is replaced with "Name," which is real data.)

- [ ] **Step 2: Fix `ipfsUpload()` to call the real content-upload route**

Find (lines 1278-1291):

```js
async function ipfsUpload(){
  const txt=(document.getElementById('ip-txt')?.value||'').trim();
  if(!txt){toast('Enter content');return;}
  const btn=document.getElementById('ip-up-btn');btn.disabled=true;btn.textContent='Uploading...';
  try {
    const r=await api('/api/storage/pin',{method:'POST',body:JSON.stringify({content:txt})});
    const d=await r.json();
    if(d.cid||d.hash){
      set('ip-up-cid',d.cid||d.hash);
      show('ip-up-result',true);toast('Pinned!');loadIPFS();
    } else {toast('Error: '+(d.error||'Unknown'));}
  } catch(e){toast('Error: '+e.message);}
  finally{btn.disabled=false;btn.textContent='&#x1F4E4; Pin to IPFS';}
}
```

Replace it with (`/api/storage/pin` pins an *existing* CID and requires `{cid, name, owner_node}`; the route that genuinely accepts raw content is `/api/storage/add`, which expects `{content, name}` — confirmed at `src/gateway/server.ts:677-690`):

```js
async function ipfsUpload(){
  const txt=(document.getElementById('ip-txt')?.value||'').trim();
  if(!txt){toast('Enter content');return;}
  const btn=document.getElementById('ip-up-btn');btn.disabled=true;btn.textContent='Uploading...';
  try {
    const r=await api('/api/storage/add',{method:'POST',body:JSON.stringify({content:txt,name:'dashboard-upload'})});
    const d=await r.json();
    if(d.cid){
      set('ip-up-cid',d.cid);
      show('ip-up-result',true);toast('Pinned!');loadIPFS();
    } else {toast('Error: '+(d.error||'Unknown'));}
  } catch(e){toast('Error: '+e.message);}
  finally{btn.disabled=false;btn.textContent='&#x1F4E4; Pin to IPFS';}
}
```

- [ ] **Step 3: Fix `ipfsFetch()`'s route**

Find (lines 1293-1304):

```js
async function ipfsFetch(){
  const cid=(document.getElementById('ip-fetch-cid')?.value||'').trim();
  if(!cid){toast('Enter a CID');return;}
  const btn=document.getElementById('ip-fetch-btn');btn.disabled=true;btn.textContent='Fetching...';
  try {
    const r=await api('/api/storage/fetch?cid='+encodeURIComponent(cid));
    const txt=await r.text();
    document.getElementById('ip-fetch-content').textContent=txt;
    show('ip-fetch-result',true);
  } catch(e){toast('Error: '+e.message);}
  finally{btn.disabled=false;btn.textContent='&#x1F50D; Fetch';}
}
```

Replace it with (real route is `GET /api/storage/get/:cid`, cid in the path — confirmed at `src/gateway/server.ts:693`):

```js
async function ipfsFetch(){
  const cid=(document.getElementById('ip-fetch-cid')?.value||'').trim();
  if(!cid){toast('Enter a CID');return;}
  const btn=document.getElementById('ip-fetch-btn');btn.disabled=true;btn.textContent='Fetching...';
  try {
    const r=await api('/api/storage/get/'+encodeURIComponent(cid));
    if(!r.ok){const d=await r.json().catch(()=>({}));toast('Error: '+(d.error||r.status));return;}
    const txt=await r.text();
    document.getElementById('ip-fetch-content').textContent=txt;
    show('ip-fetch-result',true);
  } catch(e){toast('Error: '+e.message);}
  finally{btn.disabled=false;btn.textContent='&#x1F50D; Fetch';}
}
```

- [ ] **Step 4: Fix `ipfsUnpin()`'s route**

Find (lines 1306-1313):

```js
async function ipfsUnpin(cid){
  if(!confirm('Unpin '+cid+'?')) return;
  try {
    const r=await api('/api/storage/unpin',{method:'DELETE',body:JSON.stringify({cid})});
    if(r.ok){toast('Unpinned');loadIPFS();}
    else{const d=await r.json();toast('Error: '+(d.error||r.status));}
  } catch(e){toast('Error: '+e.message);}
}
```

Replace it with (real route is `DELETE /api/storage/pin/:cid`, cid in the path, no body — confirmed at `src/gateway/server.ts:724`):

```js
async function ipfsUnpin(cid){
  if(!confirm('Unpin '+cid+'?')) return;
  try {
    const r=await api('/api/storage/pin/'+encodeURIComponent(cid),{method:'DELETE'});
    if(r.ok){toast('Unpinned');loadIPFS();}
    else{const d=await r.json();toast('Error: '+(d.error||r.status));}
  } catch(e){toast('Error: '+e.message);}
}
```

- [ ] **Step 5: Grep sanity check**

```bash
grep -n "/api/storage/fetch\|/api/storage/unpin'" web/dashboard.html
```
Expected: no matches.

- [ ] **Step 6: Verify against the running node**

```bash
curl -s http://localhost:8080/api/storage | python3 -c "import json,sys; d=json.load(sys.stdin); print(d if not d.get('enabled') else {k:d[k] for k in ('enabled','ipfs_peers','pins')})"
```
Expected: prints either `{enabled: false, reason: ...}` (if no local IPFS daemon) or `{enabled: true, ipfs_peers: N, pins: N}`.

- [ ] **Step 7: Commit**

```bash
cd /home/bot/gstdbot
git add web/dashboard.html
git commit -m "fix: IPFS tab -- fix pin-list crash, field mismatches, and three dead action buttons"
```

---

### Task 4: Validators tab — near-total field mismatch and dead toggle

**Files:**
- Modify: `web/dashboard.html` (`renderValidators()`, `toggleValidator()` — lines 1328-1369)

**Interfaces:** None — self-contained within this tab. Consumes `GET /api/validators` → `{validators: ValidatorStatus[]}` where `ValidatorStatus = {id, name, icon, description, type, ramMb, diskGb, syncTimeMin, earningsGstd, available, state: {enabled, status, syncPct, peers, blockHeight, earnings, ...}}` (confirmed at `src/validators/manager.ts:36-65, 124-129`), and `POST /api/validators/:chain/toggle`.

- [ ] **Step 1: Rewrite `renderValidators()` to read the real nested fields**

Find (lines 1328-1361):

```js
function renderValidators(data){
  const vals=data.validators||data||[];
  const el=document.getElementById('v-list');
  if(!vals.length){el.innerHTML='<div class="empty"><div class="ei">&#x26D3;</div><h4>No validators configured</h4><p>Validators let you earn extra rewards by validating transactions</p></div>';return;}
  const icons={TON:'&#x1F48E;',ETH:'&#x1F537;',BTC:'&#x1F7E0;',SOL:'&#x1F308;',BNB:'&#x1F7E1;'};
  const cols={TON:'rgba(6,182,212,0.15)',ETH:'rgba(98,126,234,0.15)',BTC:'rgba(245,158,11,0.15)',SOL:'rgba(153,69,255,0.15)',BNB:'rgba(240,185,11,0.15)'};
  el.innerHTML=vals.map(v=>{
    const ck=(v.chain||v.id||'').toUpperCase().replace(/[^A-Z]/g,'');
    const icon=icons[ck]||'&#x26D3;';
    const col=cols[ck]||'rgba(139,92,246,0.15)';
    const run=v.status==='running'||v.status==='active'||v.enabled;
    const err=v.status==='error'||v.status==='failed';
    return `<div class="v-card">
      <div class="row gap12 mb16">
        <div class="v-icon" style="background:${col}">${icon}</div>
        <div style="flex:1">
          <div class="fw6 mb8">${esc(v.name||v.chain||v.id||'Validator')}</div>
          <div class="muted sm">${esc(v.description||v.desc||'Blockchain validator node')}</div>
        </div>
        <div class="row gap8">
          ${run?'<span class="badge badge-green">Running</span>':err?'<span class="badge badge-red">Error</span>':'<span class="badge badge-muted">Stopped</span>'}
          <label class="toggle"><input type="checkbox" ${run?'checked':''} onchange="toggleValidator('${esc(v.id||v.chain||'')}',this.checked)"><span class="tg-sl"></span></label>
        </div>
      </div>
      <div class="row gap12" style="flex-wrap:wrap">
        ${v.earnings_day!==undefined?`<div><div class="muted sm mb8">Earnings/day</div><div class="fw6 tg">${v.earnings_day||0} GSTD</div></div>`:''}
        ${v.ram_req?`<div><div class="muted sm mb8">RAM</div><div class="fw6">${v.ram_req}</div></div>`:''}
        ${v.disk_req?`<div><div class="muted sm mb8">Disk</div><div class="fw6">${v.disk_req}</div></div>`:''}
        ${v.stake?`<div><div class="muted sm mb8">Stake</div><div class="fw6 ta">${v.stake}</div></div>`:''}
        ${v.synced!==undefined?`<div><div class="muted sm mb8">Sync</div><div class="fw6 ${v.synced?'tg':'ty'}">${v.synced?'Synced':'Syncing...'}</div></div>`:''}
      </div>
    </div>`;
  }).join('');
}
```

Replace it with (reads `v.state.*` for live status, `v.earningsGstd`/`v.ramMb`/`v.diskGb` for spec values, drops the `stake` row entirely since no such field exists anywhere in the backend):

```js
function renderValidators(data){
  const vals=data.validators||data||[];
  const el=document.getElementById('v-list');
  if(!vals.length){el.innerHTML='<div class="empty"><div class="ei">&#x26D3;</div><h4>No validators configured</h4><p>Validators let you earn extra rewards by validating transactions</p></div>';return;}
  const icons={TON:'&#x1F48E;',ETH:'&#x1F537;',BTC:'&#x1F7E0;',SOL:'&#x1F308;',BNB:'&#x1F7E1;'};
  const cols={TON:'rgba(6,182,212,0.15)',ETH:'rgba(98,126,234,0.15)',BTC:'rgba(245,158,11,0.15)',SOL:'rgba(153,69,255,0.15)',BNB:'rgba(240,185,11,0.15)'};
  el.innerHTML=vals.map(v=>{
    const st=v.state||{};
    const ck=(v.id||'').toUpperCase().replace(/[^A-Z]/g,'');
    const icon=icons[ck]||'&#x26D3;';
    const col=cols[ck]||'rgba(139,92,246,0.15)';
    const run=st.enabled&&st.status!=='error';
    const err=st.status==='error';
    return `<div class="v-card">
      <div class="row gap12 mb16">
        <div class="v-icon" style="background:${col}">${icon}</div>
        <div style="flex:1">
          <div class="fw6 mb8">${esc(v.name||v.id||'Validator')}</div>
          <div class="muted sm">${esc(v.description||'Blockchain validator node')}</div>
        </div>
        <div class="row gap8">
          ${run?'<span class="badge badge-green">Running</span>':err?'<span class="badge badge-red">Error</span>':'<span class="badge badge-muted">Stopped</span>'}
          <label class="toggle"><input type="checkbox" ${st.enabled?'checked':''} onchange="toggleValidator('${esc(v.id||'')}',this.checked)"><span class="tg-sl"></span></label>
        </div>
      </div>
      <div class="row gap12" style="flex-wrap:wrap">
        <div><div class="muted sm mb8">Earnings/day</div><div class="fw6 tg">${v.earningsGstd||0} GSTD</div></div>
        <div><div class="muted sm mb8">RAM</div><div class="fw6">${fmtMB(v.ramMb)}</div></div>
        <div><div class="muted sm mb8">Disk</div><div class="fw6">${v.diskGb||0} GB</div></div>
        ${st.enabled?`<div><div class="muted sm mb8">Sync</div><div class="fw6 ${st.status==='ready'?'tg':'ty'}">${st.status==='ready'?'Synced':(st.syncPct||0)+'% synced'}</div></div>`:''}
      </div>
    </div>`;
  }).join('');
}
```

- [ ] **Step 2: Fix `toggleValidator()`'s route and method**

Find (lines 1363-1369):

```js
async function toggleValidator(id,enabled){
  try {
    const r=await api('/api/validators/'+id,{method:'PATCH',body:JSON.stringify({enabled})});
    if(!r.ok){toast('Failed to toggle');loadValidators();}
    else{toast(enabled?'Starting...':'Stopped');setTimeout(loadValidators,2000);}
  } catch(e){toast('Error: '+e.message);loadValidators();}
}
```

Replace it with (real route is `POST /api/validators/:chain/toggle`, no body needed — confirmed at `src/gateway/server.ts:4038-4045`):

```js
async function toggleValidator(id,enabled){
  try {
    const r=await api('/api/validators/'+id+'/toggle',{method:'POST'});
    if(!r.ok){toast('Failed to toggle');loadValidators();}
    else{toast(enabled?'Starting...':'Stopped');setTimeout(loadValidators,2000);}
  } catch(e){toast('Error: '+e.message);loadValidators();}
}
```

- [ ] **Step 3: Grep sanity check**

```bash
grep -n "v.status===\|v.earnings_day\|v.ram_req\|v.disk_req\|v.stake\|v.synced\|method:'PATCH'" web/dashboard.html
```
Expected: no matches.

- [ ] **Step 4: Verify against the running node**

```bash
curl -s http://localhost:8080/api/validators | python3 -c "
import json,sys
d=json.load(sys.stdin)
v=d['validators'][0]
assert 'state' in v and 'ramMb' in v and 'earningsGstd' in v, 'shape mismatch'
print('OK, sample:', {k:v[k] for k in ('id','name','ramMb','diskGb','earningsGstd')}, 'state:', v['state'])
"
```
Expected: prints `OK, sample: {...}` with no assertion error.

- [ ] **Step 5: Commit**

```bash
cd /home/bot/gstdbot
git add web/dashboard.html
git commit -m "fix: Validators tab -- read real nested state, fix dead toggle button, drop fabricated stake field"
```

---

### Task 5: Wallet tab — field fix, dead stat, misleading claim result, trust-model labeling

**Files:**
- Modify: `src/gateway/server.ts` (`/api/node/status`'s `swarm` object; `/api/wallet/claim` — no code change needed there, see Step 3)
- Modify: `web/dashboard.html` (`loadWallet()`, `claimRewards()`, and the Wallet tab's static HTML around `w-rate`/`w-claim-info`)

**Interfaces:**
- Produces: `/api/node/status`'s `swarm` object gains an `effectiveRate` field (number, GSTD/hour). No other task consumes this.

- [ ] **Step 1: Add `effectiveRate` to the `/api/node/status` handler's `swarm` object**

Find in `src/gateway/server.ts` (the `swarm: (() => {...})()` IIFE inside the `/api/node/status` handler):

```ts
                swarm: (() => {
                    const agent = this.subsystems?.swarm;
                    const stats = agent?.getStats?.();
                    return {
                        enabled: process.env.SWARM_ENABLED !== 'false',
                        status: stats?.connected ? 'connected' : 'standalone',
                        connected: stats?.connected || false,
                        mode: process.env.GSTD_SOVEREIGNTY_MODE || 'full',
                        peers: stats?.peersCount || 0,
                        tasksCompleted: stats?.tasksCompleted || 0,
                        tasksProcessing: stats?.tasksProcessing || 0,
                        totalEarnedGstd: stats?.totalEarnedGstd || 0,
                        uptimeSeconds: stats?.uptimeSeconds || 0,
                        lastHeartbeat: stats?.lastHeartbeat || null,
                        rank: stats?.rank || 0,
                    };
                })(),
```

Replace it with:

```ts
                swarm: (() => {
                    const agent = this.subsystems?.swarm;
                    const stats = agent?.getStats?.();
                    return {
                        enabled: process.env.SWARM_ENABLED !== 'false',
                        status: stats?.connected ? 'connected' : 'standalone',
                        connected: stats?.connected || false,
                        mode: process.env.GSTD_SOVEREIGNTY_MODE || 'full',
                        peers: stats?.peersCount || 0,
                        tasksCompleted: stats?.tasksCompleted || 0,
                        tasksProcessing: stats?.tasksProcessing || 0,
                        totalEarnedGstd: stats?.totalEarnedGstd || 0,
                        effectiveRate: stats?.effectiveRate || 0,
                        uptimeSeconds: stats?.uptimeSeconds || 0,
                        lastHeartbeat: stats?.lastHeartbeat || null,
                        rank: stats?.rank || 0,
                    };
                })(),
```

- [ ] **Step 2: Fix `loadWallet()`'s earnings-history Detail column, and wire the Reward Rate stat + connection-aware claim-info text**

Find (lines 1372-1401):

```js
async function loadWallet(){
  try {
    const [wal,earn]=await Promise.allSettled([
      api('/api/wallet/live').then(r=>r.json()),
      api('/api/node/earnings').then(r=>r.json()),
    ]);
    if(wal.status==='fulfilled'){
      const d=wal.value;const addr=d.address||'';
      document.getElementById('w-full').value=addr;
      set('w-addr',trunc(addr,16,8));
      set('w-today',fmt4(d.earningsToday));
      const lnk=document.getElementById('w-exp');
      if(lnk&&addr) lnk.href='https://tonscan.org/address/'+addr;
    }
    if(earn.status==='fulfilled'){
      const d=earn.value;
      set('w-total',fmt4(d.total||d.today||0));
      const hist=d.earnings||[];
      const el=document.getElementById('w-hist');
      if(!hist.length){el.innerHTML='<div class="empty"><div class="ei">&#x1F4B0;</div><h4>No earnings yet</h4><p>Earnings are recorded when the swarm rewards your node</p></div>';return;}
      el.innerHTML='<table class="tbl"><thead><tr><th>Time</th><th>Amount</th><th>Type</th><th>Detail</th></tr></thead><tbody>'+
        hist.slice(0,50).map(e=>`<tr>
          <td class="muted sm">${e.timestamp?new Date(e.timestamp).toLocaleString():'—'}</td>
          <td class="tg fw6">${fmt4(e.amount||0)} GSTD</td>
          <td><span class="badge badge-accent">${esc(e.type||e.source||'inference')}</span></td>
          <td class="muted sm">${esc(e.detail||e.model||'')}</td>
        </tr>`).join('')+'</tbody></table>';
    }
  } catch(e){console.error('loadWallet',e);}
}
```

Replace it with (Detail column reads `description`, the real `EarningEntry` field; Reward Rate is now wired to the real `swarm.effectiveRate` field added in Step 1 via a third parallel fetch; claim-info text reflects real connection state instead of a static placeholder):

```js
async function loadWallet(){
  try {
    const [wal,earn,st]=await Promise.allSettled([
      api('/api/wallet/live').then(r=>r.json()),
      api('/api/node/earnings').then(r=>r.json()),
      api('/api/node/status').then(r=>r.json()),
    ]);
    if(wal.status==='fulfilled'){
      const d=wal.value;const addr=d.address||'';
      document.getElementById('w-full').value=addr;
      set('w-addr',trunc(addr,16,8));
      set('w-today',fmt4(d.earningsToday));
      const lnk=document.getElementById('w-exp');
      if(lnk&&addr) lnk.href='https://tonscan.org/address/'+addr;
    }
    if(earn.status==='fulfilled'){
      const d=earn.value;
      set('w-total',fmt4(d.total||d.today||0));
      const hist=d.earnings||[];
      const el=document.getElementById('w-hist');
      if(!hist.length){el.innerHTML='<div class="empty"><div class="ei">&#x1F4B0;</div><h4>No earnings yet</h4><p>Earnings are recorded when the swarm rewards your node</p></div>';return;}
      el.innerHTML='<table class="tbl"><thead><tr><th>Time</th><th>Amount</th><th>Type</th><th>Detail</th></tr></thead><tbody>'+
        hist.slice(0,50).map(e=>`<tr>
          <td class="muted sm">${e.timestamp?new Date(e.timestamp).toLocaleString():'—'}</td>
          <td class="tg fw6">${fmt4(e.amount||0)} GSTD</td>
          <td><span class="badge badge-accent">${esc(e.type||e.source||'inference')}</span></td>
          <td class="muted sm">${esc(e.description||'')}</td>
        </tr>`).join('')+'</tbody></table>';
    }
    if(st.status==='fulfilled'){
      const d=st.value;
      set('w-rate',(d.swarm?.effectiveRate||0).toFixed(2));
      const connected=d.platform_health?.connected;
      set('w-claim-info',connected?'Connected to platform -- claim will process immediately.':'Platform unreachable -- claim may fail until connectivity is restored.');
    }
  } catch(e){console.error('loadWallet',e);}
}
```

- [ ] **Step 3: Fix `claimRewards()` to branch on `d.success`, not `r.ok`**

Find (lines 1417-1428):

```js
async function claimRewards(){
  if(!confirm('Claim accumulated rewards?')) return;
  const btn=document.getElementById('w-claim-btn');btn.disabled=true;
  const res=document.getElementById('w-claim-res');res.style.display='block';res.innerHTML='<span class="muted sm">Processing...</span>';
  try {
    const r=await api('/api/wallet/claim',{method:'POST',body:JSON.stringify({})});
    const d=await r.json();
    if(r.ok){res.innerHTML=`<span class="tg sm">${esc(d.message||'Claim submitted!')}</span>`;toast('Claim submitted!');loadWallet();}
    else{res.innerHTML=`<span class="tr sm">Error: ${esc(d.error||'Unknown')}</span>`;}
  } catch(e){res.innerHTML=`<span class="tr sm">Error: ${esc(e.message)}</span>`;}
  finally{btn.disabled=false;}
}
```

Replace it with (`POST /api/wallet/claim` always responds with HTTP 200, signaling success/failure only via a `success` boolean in the body — confirmed at `src/gateway/server.ts:2332-2341` — so checking `r.ok` alone means a real failure was previously displayed as a false-positive green success message):

```js
async function claimRewards(){
  if(!confirm('Claim accumulated rewards?')) return;
  const btn=document.getElementById('w-claim-btn');btn.disabled=true;
  const res=document.getElementById('w-claim-res');res.style.display='block';res.innerHTML='<span class="muted sm">Processing...</span>';
  try {
    const r=await api('/api/wallet/claim',{method:'POST',body:JSON.stringify({})});
    const d=await r.json();
    if(r.ok&&d.success){res.innerHTML=`<span class="tg sm">${esc(d.message||'Claim submitted!')}</span>`;toast('Claim submitted!');loadWallet();}
    else{res.innerHTML=`<span class="tr sm">Error: ${esc(d.error||'Unknown')}</span>`;}
  } catch(e){res.innerHTML=`<span class="tr sm">Error: ${esc(e.message)}</span>`;}
  finally{btn.disabled=false;}
}
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd /home/bot/gstdbot && npx tsc --skipLibCheck`
Expected: no errors.

- [ ] **Step 5: Grep sanity check**

```bash
grep -n "e.detail||e.model\|if(r.ok){res.innerHTML=\`<span class=\"tg sm\">\${esc(d.message" web/dashboard.html
```
Expected: no matches (both old patterns replaced).

- [ ] **Step 6: Verify against the running node**

```bash
curl -s http://localhost:8080/api/node/status | python3 -c "import json,sys; d=json.load(sys.stdin); assert 'effectiveRate' in d['swarm'], 'effectiveRate missing'; print('OK:', d['swarm']['effectiveRate'])"
```
Expected: prints `OK: <number>`.

- [ ] **Step 7: Commit**

```bash
cd /home/bot/gstdbot
git add src/gateway/server.ts web/dashboard.html
git commit -m "fix: Wallet tab -- Detail column field, real Reward Rate, honest claim-result display"
```

---

### Task 6: Settings tab — update-check masking, Telegram badge, Change PIN route, remove dead Save-Telegram form

**Files:**
- Modify: `src/gateway/server.ts` (add a new `POST /api/auth/change-pin` route)
- Modify: `web/dashboard.html` (`loadSettings()`, `checkUpdate()`, `changePin()`; remove `saveTelegram()` and its form markup)

**Interfaces:** None — self-contained. Consumes `GET /api/check-update` (`{update_available, current_version, commits_behind, ...}` — confirmed at `src/gateway/server.ts:426-452`) and `GET /api/telegram/status` (`{linked, telegram: {chatId, username, linkedAt} | null}` — confirmed at `src/gateway/server.ts:1220-1223`). Produces a new `POST /api/auth/change-pin` route.

- [ ] **Step 1: Add the new `POST /api/auth/change-pin` route**

This route must live in the same enclosing scope as `/api/auth/setup` and `/api/auth/login` (both close over the module-scoped `hashPin` function and the method-scoped `pinHash`/`pinConfigured`/`pinFile` variables). Find the end of the existing `/api/auth/logout` route in `src/gateway/server.ts`:

```ts
        // POST /api/auth/logout — invalidate session token
        this.app.post('/api/auth/logout', (req, res) => {
            const token = req.headers.authorization?.replace('Bearer ', '') || '';
            if (token) {
                authSessions.delete(token);
            }
            logActivity('Dashboard logout', 'info');
            res.json({ success: true, message: 'Logged out successfully' });
        });
```

Immediately after it, add:

```ts
        // POST /api/auth/change-pin — change PIN while already authenticated (requires current PIN)
        this.app.post('/api/auth/change-pin', (req, res) => {
            if (!requireNodeAuth(req, res)) return;
            if (!pinConfigured) {
                res.status(400).json({ success: false, error: 'PIN not configured. Use /api/auth/setup first.' });
                return;
            }
            const { current_pin, new_pin } = req.body || {};
            if (!current_pin || !new_pin) {
                res.status(400).json({ success: false, error: 'current_pin and new_pin required' });
                return;
            }
            if (hashPin(current_pin) !== pinHash) {
                logActivity('Failed PIN change attempt (wrong current PIN)', 'warn');
                res.status(401).json({ success: false, error: 'Current PIN is incorrect' });
                return;
            }
            if (new_pin.length < 4 || new_pin.length > 8) {
                res.status(400).json({ success: false, error: 'New PIN must be 4-8 digits' });
                return;
            }
            pinHash = hashPin(new_pin);
            try {
                writeFileSync(pinFile, pinHash);
                logActivity('Dashboard PIN changed', 'success');
            } catch (_e) {}
            const token = createAuthToken();
            res.json({ success: true, token });
        });
```

(This follows the exact same verify-then-hash-then-persist pattern already used by `/api/auth/setup` (lines 1129-1146) and `/api/auth/login` (lines 1149-1170) — `hashPin`/`createAuthToken` are the same module-level functions those routes already use, and `requireNodeAuth` is the same authentication guard used by `/api/node/restart`/`/stop` elsewhere in this file.)

- [ ] **Step 2: Fix `loadSettings()`'s node-identity fields, update-check fields, and Telegram badge**

Find (lines 1468-1509, the body of `loadSettings()` through the end of the `tg` block):

```js
async function loadSettings(){
  try {
    const [st,hw,upd,tg,ssl]=await Promise.allSettled([
      api('/api/node/status').then(r=>r.json()),
      api('/api/node/hardware').then(r=>r.json()),
      api('/api/check-update').then(r=>r.json()),
      api('/api/telegram/status').then(r=>r.json()),
      api('/api/ssl/status').then(r=>r.json()),
    ]);
    if(st.status==='fulfilled'){
      const d=st.value;
      set('s-nid',trunc(d.nodeId||'',16,8));
      set('s-ver',d.version||'—');
      set('s-plat',d.platform||'—');
      set('s-arch',d.arch||'—');
      set('s-curver','v'+(d.version||'—'));
      const cb=document.getElementById('s-central-badge');
      if(d.platform_health&&cb){
        if(d.platform_health.connected){cb.className='badge badge-green';cb.textContent='Connected';}
        else{cb.className='badge badge-yellow';cb.textContent='Unreachable — retrying in '+Math.round(d.platform_health.nextAttemptInMs/1000)+'s';}
      }
    }
    if(hw.status==='fulfilled'){
      const d=hw.value;
      set('s-cpu',(d.cpu?.model||'Unknown').slice(0,30));
      set('s-cores',d.cpu?.cores||'—');
      set('s-ram',(d.ram?.total_gb||0)+' GB');
      set('s-disk',(d.disk?.free_gb||0)+' GB free');
    }
    if(upd.status==='fulfilled'){
      const d=upd.value;
      const bg=document.getElementById('s-upd-badge'),ub=document.getElementById('s-upd-btn');
      if(d.updateAvailable){bg.className='badge badge-yellow';bg.textContent='Update Available';set('s-upd-status','v'+d.latest+' available');ub.style.display='inline-flex';}
      else{bg.className='badge badge-green';bg.textContent='Up to date';set('s-upd-status','Already on latest version');ub.style.display='none';}
    }
    if(tg.status==='fulfilled'){
      const d=tg.value;
      const tgb=document.getElementById('s-tg-badge');
      if(d.connected||d.enabled){tgb.className='badge badge-green';tgb.textContent='Connected';}
      else{tgb.className='badge badge-muted';tgb.textContent='Not configured';}
      if(d.username||d.botUsername) document.getElementById('s-tg-tok').placeholder='Current: @'+(d.username||d.botUsername);
    }
```

Replace it with:

```js
async function loadSettings(){
  try {
    const [st,hw,upd,tg,ssl]=await Promise.allSettled([
      api('/api/node/status').then(r=>r.json()),
      api('/api/node/hardware').then(r=>r.json()),
      api('/api/check-update').then(r=>r.json()),
      api('/api/telegram/status').then(r=>r.json()),
      api('/api/ssl/status').then(r=>r.json()),
    ]);
    if(st.status==='fulfilled'){
      const d=st.value;
      set('s-nid',trunc(d.node?.nodeId||'',16,8));
      set('s-ver',d.node?.version||'—');
      set('s-plat',d.node?.platform||'—');
      set('s-arch',d.node?.arch||'—');
      set('s-curver','v'+(d.node?.version||'—'));
      const cb=document.getElementById('s-central-badge');
      if(d.platform_health&&cb){
        if(d.platform_health.connected){cb.className='badge badge-green';cb.textContent='Connected';}
        else{cb.className='badge badge-yellow';cb.textContent='Unreachable — retrying in '+Math.round(d.platform_health.nextAttemptInMs/1000)+'s';}
      }
    }
    if(hw.status==='fulfilled'){
      const d=hw.value;
      set('s-cpu',(d.cpu?.model||'Unknown').slice(0,30));
      set('s-cores',d.cpu?.cores||'—');
      set('s-ram',(d.ram?.total_gb||0)+' GB');
      set('s-disk',(d.disk?.free_gb||0)+' GB free');
    }
    if(upd.status==='fulfilled'){
      const d=upd.value;
      const bg=document.getElementById('s-upd-badge'),ub=document.getElementById('s-upd-btn');
      if(d.update_available){bg.className='badge badge-yellow';bg.textContent='Update Available';set('s-upd-status',d.commits_behind+' commit'+(d.commits_behind!==1?'s':'')+' behind (current v'+d.current_version+')');ub.style.display='inline-flex';}
      else{bg.className='badge badge-green';bg.textContent='Up to date';set('s-upd-status','Already on latest: v'+(d.current_version||''));ub.style.display='none';}
    }
    if(tg.status==='fulfilled'){
      const d=tg.value;
      const tgb=document.getElementById('s-tg-badge');
      if(d.linked){tgb.className='badge badge-green';tgb.textContent='Connected';}
      else{tgb.className='badge badge-muted';tgb.textContent='Not configured';}
    }
```

(Note: `s-tg-tok` no longer has its placeholder updated, since Step 4 below removes the Save-Telegram token input entirely.)

- [ ] **Step 3: Fix `checkUpdate()`'s field names**

Find (lines 1531-1540):

```js
async function checkUpdate(){
  const btn=document.getElementById('s-chk-btn');btn.disabled=true;btn.textContent='Checking...';
  try {
    const d=await api('/api/check-update').then(r=>r.json());
    const bg=document.getElementById('s-upd-badge'),ub=document.getElementById('s-upd-btn');
    if(d.updateAvailable){bg.className='badge badge-yellow';bg.textContent='Update Available';set('s-upd-status','v'+d.latest+' available (current v'+d.current+')');ub.style.display='inline-flex';}
    else{bg.className='badge badge-green';bg.textContent='Up to date';set('s-upd-status','Already on latest: v'+(d.current||''));ub.style.display='none';}
  } catch(e){toast('Check failed: '+e.message);}
  finally{btn.disabled=false;btn.textContent='&#x1F50D; Check';}
}
```

Replace it with:

```js
async function checkUpdate(){
  const btn=document.getElementById('s-chk-btn');btn.disabled=true;btn.textContent='Checking...';
  try {
    const d=await api('/api/check-update').then(r=>r.json());
    const bg=document.getElementById('s-upd-badge'),ub=document.getElementById('s-upd-btn');
    if(d.update_available){bg.className='badge badge-yellow';bg.textContent='Update Available';set('s-upd-status',d.commits_behind+' commit'+(d.commits_behind!==1?'s':'')+' behind (current v'+d.current_version+')');ub.style.display='inline-flex';}
    else{bg.className='badge badge-green';bg.textContent='Up to date';set('s-upd-status','Already on latest: v'+(d.current_version||''));ub.style.display='none';}
  } catch(e){toast('Check failed: '+e.message);}
  finally{btn.disabled=false;btn.textContent='&#x1F50D; Check';}
}
```

- [ ] **Step 4: Remove `saveTelegram()` and its form markup entirely**

The bot-deep-link linking flow (`POST /api/telegram/link`, triggered from the Telegram bot itself, not the dashboard) already works and is the only linking path this codebase actually implements — no code anywhere reads a manually-saved bot token back for sending messages (`TELEGRAM_BOT_TOKEN` is read once from the process environment at `src/gateway/server.ts:1226`). The "Save Telegram token" form is a dead end with no real feature behind it.

Find and delete the entire function (lines 1571-1580):

```js
async function saveTelegram(){
  const t=(document.getElementById('s-tg-tok')?.value||'').trim();
  if(!t){toast('Enter a bot token');return;}
  try {
    const r=await api('/api/telegram/configure',{method:'POST',body:JSON.stringify({token:t})});
    const d=await r.json();
    if(r.ok){toast('Telegram saved!');loadSettings();}
    else{toast('Error: '+(d.error||r.status));}
  } catch(e){toast('Error: '+e.message);}
}
```

Then find the HTML input/button that calls it — search for `onclick="saveTelegram()"` and the `id="s-tg-tok"` input field in the Settings tab's Telegram card, and remove that input + button (keep the rest of the Telegram card, including the status badge and any content about linking via the bot).

- [ ] **Step 5: Fix `changePin()` to call the new real route (no frontend change needed — it already calls `/api/auth/change-pin` with the right body shape)**

Re-read the current `changePin()` function and confirm it already sends `{current_pin, new_pin}` to `POST /api/auth/change-pin` (lines 1557-1569) — it does, and this matches Step 1's new route exactly. No frontend change is needed here; this step is verification only, not a code change.

- [ ] **Step 6: Verify TypeScript compiles**

Run: `cd /home/bot/gstdbot && npx tsc --skipLibCheck`
Expected: no errors.

- [ ] **Step 7: Grep sanity check**

```bash
grep -n "d.updateAvailable\|d.connected||d.enabled\|saveTelegram\|/api/telegram/configure\|s-tg-tok" web/dashboard.html
```
Expected: no matches (all removed or replaced).

- [ ] **Step 8: Verify against the running node**

```bash
echo "-- check-update shape --"
curl -s http://localhost:8080/api/check-update | python3 -c "import json,sys; d=json.load(sys.stdin); assert 'update_available' in d and 'commits_behind' in d; print('OK')"
echo "-- change-pin requires auth --"
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:8080/api/auth/change-pin -H "Content-Type: application/json" -d '{"current_pin":"0000","new_pin":"1111"}'
```
Expected: first prints `OK`; second prints `401` (unauthenticated request correctly rejected by `requireNodeAuth` — do NOT test this with a real valid session token against the live production PIN, since that would actually change it).

- [ ] **Step 9: Commit**

```bash
cd /home/bot/gstdbot
git add src/gateway/server.ts web/dashboard.html
git commit -m "fix: Settings tab -- real update-check fields, Telegram badge, working Change PIN, remove dead Save-Telegram form"
```

---

### Task 7: Final verification

**Files:** None modified — verification only.

**Interfaces:** None.

- [ ] **Step 1: Full clean build and test suite**

```bash
cd /home/bot/gstdbot
npx tsc --skipLibCheck
npx vitest run
```
Expected: both clean; vitest still shows the `platform-health.test.ts` suite passing (5 tests) plus `index.test.ts` (1 test) from the prior sub-project, unaffected by this one.

- [ ] **Step 2: Full grep sweep for every old broken pattern found across all 6 tasks**

```bash
cd /home/bot/gstdbot
grep -n "mods.models\b\|/api/ollama/pull'\|/api/ollama/delete'\|const CATALOG\|/api/storage/fetch\|/api/storage/unpin'\|v.status===\|v.earnings_day\|v.ram_req\|v.disk_req\|v.stake\b\|v.synced\|method:'PATCH'\|e.detail||e.model\|d.updateAvailable\|d.connected||d.enabled\|saveTelegram\|/api/telegram/configure\|s\.name||'GSTD Node'\|s\.nodeId\b" web/dashboard.html
```
Expected: no matches at all — every field/route bug found across Tasks 1-6 is gone.

- [ ] **Step 3: Restart the live node and verify no regressions**

```bash
cd /home/bot/gstdbot
node_modules/.bin/tsc --skipLibCheck
pm2 restart gstdbot
sleep 20
pm2 describe gstdbot 2>&1 | grep -E "status|restarts|unstable"
```
Expected: `status: online`, `unstable restarts: 0`.

- [ ] **Step 4: Spot-check the dashboard's actual rendered data end-to-end**

```bash
echo "-- node status shape --"
curl -s http://localhost:8080/api/node/status | python3 -c "
import json,sys
d=json.load(sys.stdin)
assert 'nodeId' in d['node']
assert 'effectiveRate' in d['swarm']
print('node.nodeId:', d['node']['nodeId'][:16])
print('swarm.effectiveRate:', d['swarm']['effectiveRate'])
"
echo "-- ollama models shape --"
curl -s http://localhost:8080/api/ollama/models | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('installed:', len(d['installed']), 'catalog:', len(d['catalog']))
"
echo "-- validators shape --"
curl -s http://localhost:8080/api/validators | python3 -c "
import json,sys
d=json.load(sys.stdin)
v=d['validators'][0]
print('sample:', v['id'], v['state']['status'], v['ramMb'], v['earningsGstd'])
"
```
Expected: all three print without assertion errors, showing the corrected field shapes are live.

- [ ] **Step 5: Report completion**

No further action if all checks pass. This closes out the "dashboard-reliability-fix" sub-project. Remaining sub-projects from the original 4-way decomposition (UI visual redesign, dynamic model loading — largely already delivered as a side effect of Task 2's fixes, and true network-wide model-aware routing / sub-project C) are separate, not started by this plan. The "apps" mostly-placeholder-content issue found during the audit remains explicitly out of scope per the design spec.
