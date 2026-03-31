const API = 'http://localhost:3000';

/* node colours matching the CSS variables */
const NODE_COLORS = {
    Author:      { bg: '#ff7b72', border: '#c9372c' },
    Paper:       { bg: '#79c0ff', border: '#388bfd' },
    Concept:     { bg: '#d2a8ff', border: '#8957e5' },
    Institution: { bg: '#56d364', border: '#2ea043' }
};

let network     = null;
let currentView = 'table';
let activeKey   = null;

// ── Bootstrap ──────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    await loadQueryList();
});

async function loadQueryList() {
    try {
        const res  = await fetch(`${API}/api/queries`);
        const list = await res.json();

        const container = document.getElementById('query-list');
        container.innerHTML = '';

        list.forEach((q, i) => {
            const btn = document.createElement('button');
            btn.className   = 'query-item';
            btn.dataset.key = q.key;
            btn.innerHTML   = `
                <div class="q-num">Q${String(i + 1).padStart(2, '0')}</div>
                <div class="q-label">${q.label}</div>
            `;
            btn.addEventListener('click', () => runQuery(q.key, btn));
            container.appendChild(btn);
        });

        setDbStatus(true);
    } catch {
        setDbStatus(false);
        document.getElementById('query-list').innerHTML =
            '<div class="loading-queries">Cannot reach server — is it running?</div>';
    }
}

// ── Run a query ────────────────────────────────────────────────────────────
async function runQuery(key, btnEl) {
    // highlight active button
    document.querySelectorAll('.query-item').forEach(b => b.classList.remove('active'));
    btnEl.classList.add('active');
    activeKey = key;

    showSpinner(true);

    try {
        if (currentView === 'graph' && key === 'full_subgraph') {
            const res  = await fetch(`${API}/api/graph`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ queryKey: key })
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.error);
            renderGraph(data.records, data.label);
            setActiveTitle(data.label);
            showDescription(data.description || '');
        } else {
            const res  = await fetch(`${API}/api/query`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ queryKey: key })
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.error);

            setActiveTitle(data.label);
            showDescription(data.description || '');
            renderTable(data.records);

            // if we're in graph view and it's the subgraph query — also draw graph
            if (currentView === 'graph') {
                renderGraphFromTableRecords(data.records, key);
            }
        }
        setDbStatus(true);
    } catch (e) {
        setDbStatus(false);
        alert(`Query failed: ${e.message}`);
    } finally {
        showSpinner(false);
    }
}

// ── Table rendering ────────────────────────────────────────────────────────
function renderTable(records) {
    if (!records || records.length === 0) {
        document.getElementById('empty-state').style.display = 'flex';
        document.getElementById('table-wrap').style.display  = 'none';
        document.getElementById('results-meta').textContent  = '';
        return;
    }

    const keys = Object.keys(records[0]);

    // head
    const thead = document.getElementById('table-head');
    thead.innerHTML = '<tr>' + keys.map(k => `<th>${k}</th>`).join('') + '</tr>';

    // body
    const tbody = document.getElementById('table-body');
    tbody.innerHTML = records.map(row =>
        '<tr>' + keys.map(k => {
            const v = row[k];
            const display = Array.isArray(v) ? v.join(', ') : (v ?? '—');
            const cls = String(display).length > 60 ? ' class="wrap"' : '';
            return `<td${cls} title="${String(display).replace(/"/g, '&quot;')}">${display}</td>`;
        }).join('') + '</tr>'
    ).join('');

    document.getElementById('results-meta').textContent =
        `${records.length} row${records.length !== 1 ? 's' : ''} returned`;

    document.getElementById('empty-state').style.display = 'none';
    document.getElementById('table-wrap').style.display  = 'flex';
}

// ── Graph rendering (for Q10 full_subgraph) ────────────────────────────────
function renderGraph(records, label) {
    const nodesMap = new Map();
    const edgesArr = [];

    for (const r of records) {
        // Q10 returns: aId, aName, pId, pTitle, cId, cName
        addNode(nodesMap, r.aId, r.aName, 'Author');
        addNode(nodesMap, r.pId, r.pTitle, 'Paper');
        addNode(nodesMap, r.cId, r.cName, 'Concept');

        edgesArr.push({ from: r.aId, to: r.pId, label: 'WRITES',      arrows: 'to' });
        edgesArr.push({ from: r.pId, to: r.cId, label: 'BELONGS_TO',  arrows: 'to' });
    }

    drawNetwork(nodesMap, edgesArr);
}

// fallback graph builder for non-subgraph queries
function renderGraphFromTableRecords(records, key) {
    if (!records || records.length === 0) return;

    const nodesMap = new Map();
    const edgesArr = [];

    // best-effort: create nodes from whatever columns are present
    for (const r of records) {
        const keys = Object.keys(r);
        const vals = keys.map(k => ({ key: k, val: r[k] })).filter(x => typeof x.val === 'string' && x.val);

        // pair consecutive string columns as source→target
        for (let i = 0; i < vals.length - 1; i++) {
            const src = vals[i],  tgt = vals[i + 1];
            const srcType = guessType(src.key);
            const tgtType = guessType(tgt.key);
            addNode(nodesMap, `${srcType}:${src.val}`, truncate(src.val, 35), srcType);
            addNode(nodesMap, `${tgtType}:${tgt.val}`, truncate(tgt.val, 35), tgtType);
            edgesArr.push({
                from: `${srcType}:${src.val}`,
                to:   `${tgtType}:${tgt.val}`,
                arrows: 'to'
            });
        }
    }

    drawNetwork(nodesMap, edgesArr);
}

function addNode(map, id, label, type) {
    if (!id || map.has(id)) return;
    const col = NODE_COLORS[type] || { bg: '#888', border: '#555' };
    map.set(id, {
        id,
        label: truncate(String(label), 30),
        title: String(label),   // tooltip on hover
        color: { background: col.bg, border: col.border, highlight: { background: col.bg, border: '#fff' } },
        font:  { color: '#e6edf3', size: 11 },
        shape: type === 'Paper' ? 'box' : 'dot',
        size:  type === 'Author' ? 20 : 14
    });
}

function drawNetwork(nodesMap, edgesArr) {
    const container = document.getElementById('network-container');

    // dedupe edges
    const seen = new Set();
    const edges = edgesArr.filter(e => {
        const k = `${e.from}→${e.to}→${e.label ?? ''}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
    });

    const data    = { nodes: new vis.DataSet([...nodesMap.values()]), edges: new vis.DataSet(edges) };
    const options = {
        physics: {
            solver: 'forceAtlas2Based',
            forceAtlas2Based: { gravitationalConstant: -30, centralGravity: 0.003, springLength: 160, springConstant: 0.08 },
            maxVelocity: 60,
            stabilization: { iterations: 200 }
        },
        edges: {
            color: { color: '#30363d', highlight: '#58a6ff' },
            font:  { color: '#7d8590', size: 9, align: 'middle' },
            smooth: { type: 'continuous' },
            selectionWidth: 2
        },
        interaction: { hover: true, tooltipDelay: 150 }
    };

    if (network) network.destroy();
    network = new vis.Network(container, data, options);
}

// ── View switching ─────────────────────────────────────────────────────────
function switchView(view) {
    currentView = view;
    document.getElementById('btn-table').classList.toggle('active', view === 'table');
    document.getElementById('btn-graph').classList.toggle('active', view === 'graph');
    document.getElementById('view-table').style.display = view === 'table' ? 'flex' : 'none';
    document.getElementById('view-graph').style.display = view === 'graph' ? 'flex' : 'none';

    // if switching to graph and a query is already loaded, re-render
    if (view === 'graph' && activeKey) {
        const tbody = document.getElementById('table-body');
        if (tbody.children.length > 0) {
            const rows = tableToRecords();
            if (activeKey === 'full_subgraph') {
                renderGraph(rows, activeKey);
            } else {
                renderGraphFromTableRecords(rows, activeKey);
            }
        }
    }
}

// scrape current table back into record objects (avoids a second API call)
function tableToRecords() {
    const headers = [...document.querySelectorAll('#table-head th')].map(th => th.textContent);
    return [...document.querySelectorAll('#table-body tr')].map(tr => {
        const cells = [...tr.querySelectorAll('td')].map(td => td.title || td.textContent);
        return Object.fromEntries(headers.map((h, i) => [h, cells[i]]));
    });
}

// ── Helpers ────────────────────────────────────────────────────────────────
function setActiveTitle(t) {
    const el = document.getElementById('active-query-title');
    el.textContent = t;
    el.classList.add('running');
}

function showDescription(text) {
    const banner = document.getElementById('reasoning-banner');
    const textEl = document.getElementById('reasoning-text');
    if (text) {
        textEl.textContent = text;
        banner.style.display = 'flex';
    } else {
        banner.style.display = 'none';
    }
}

function showSpinner(on) {
    document.getElementById('spinner').style.display = on ? 'flex' : 'none';
}

function setDbStatus(online) {
    const dot  = document.querySelector('.db-status .dot');
    const text = document.getElementById('db-status-text');
    dot.className  = 'dot ' + (online ? 'online' : 'offline');
    text.textContent = online ? 'Connected to Neo4j' : 'Server offline';
}

function guessType(key) {
    const k = key.toLowerCase();
    if (k.includes('author') || k.includes('researcher') || k.includes('candidate')) return 'Author';
    if (k.includes('paper') || k.includes('pub'))  return 'Paper';
    if (k.includes('concept') || k.includes('field')) return 'Concept';
    if (k.includes('inst') || k.includes('univ') || k.includes('country')) return 'Institution';
    return 'Paper'; // default
}

function truncate(s, n) {
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
