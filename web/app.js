let network = null;

const COLORS = {
    Author: '#ff7b72',
    Paper: '#79c0ff',
    Concept: '#d2a8ff',
    Institution: '#a5d6ff'
};

async function runQuery(queryKey) {
    const statusEl = document.getElementById('status-text');
    statusEl.innerText = "Querying Neo4j...";
    statusEl.className = "";

    try {
        const res = await fetch('http://localhost:3000/api/query', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ queryKey })
        });

        if (!res.ok) throw new Error("Server error - is Neo4j running?");

        const data = await res.json();
        if (data.success) {
            statusEl.innerText = `Success: Retrieved ${data.records.length} paths`;
            statusEl.className = "status-online";
            renderGraph(data.records);
        } else {
            throw new Error(data.error);
        }
    } catch (err) {
        statusEl.innerText = `Error: ${err.message}`;
        statusEl.className = "status-offline";
        console.error(err);
    }
}

function renderGraph(records) {
    const container = document.getElementById('mynetwork');
    
    // Parse records into vis.js nodes and edges
    let nodesMap = new Map();
    let edgesMap = new Map();

    records.forEach(record => {
        // Neo4j returns paths via our custom cypher output variables
        // We look for any key that looks like a node and any that looks like a relationship
        
        const maybeAddNode = (obj) => {
            if (obj && obj.id && obj.label) {
                if (!nodesMap.has(obj.id)) {
                    nodesMap.set(obj.id, {
                        id: obj.id,
                        label: obj.name || obj.title || obj.id,
                        color: {
                            background: COLORS[obj.label] || '#999',
                            border: '#30363d'
                        },
                        font: { color: '#c9d1d9' },
                        shape: 'dot',
                        size: obj.label === 'Paper' ? 15 : 25
                    });
                }
                return obj.id;
            }
            return null;
        };

        const keys = Object.keys(record);
        
        // Very basic heuristic to parse our customized cypher return objects
        // (source, target, rel, endNode)
        
        let lastNodeId = null;
        
        // This is a simplified parser designed specifically for the queries we wrote
        if (record.source && record.target && record.rel) {
            let n1 = maybeAddNode(record.source);
            let n2 = maybeAddNode(record.target);
            if (n1 && n2) {
                let edgeId = `${n1}-${record.rel.type}-${n2}`;
                edgesMap.set(edgeId, { from: n1, to: n2, label: record.rel.type, font: { color: '#8b949e', size: 10 } });
            }
            
            if (record.endNode && record.rel2) {
                let n3 = maybeAddNode(record.endNode);
                if (n2 && n3) {
                    let edgeId2 = `${n2}-${record.rel2.type}-${n3}`;
                    edgesMap.set(edgeId2, { from: n2, to: n3, label: record.rel2.type, font: { color: '#8b949e', size: 10 } });
                }
            }
        }
        
        if (record.n1 && record.n2 && record.rel2) {
            let n1 = maybeAddNode(record.n1);
            let n2 = maybeAddNode(record.n2);
            let c = maybeAddNode(record.concept);
            let i1 = maybeAddNode(record.i1_node);
            let i2 = maybeAddNode(record.i2_node);
            
            edgesMap.set(`${n1}-AFFILIATED_WITH-${i1}`, { from: n1, to: i1, label: "AFFILIATED_WITH", dashes: true });
            edgesMap.set(`${n2}-AFFILIATED_WITH-${i2}`, { from: n2, to: i2, label: "AFFILIATED_WITH", dashes: true });
            edgesMap.set(`${n1}-SAME_FIELD_AS-${n2}`, { from: n1, to: n2, label: "SAME_FIELD_AS", color: '#ff7b72' });
        }
    });

    const nodesData = new vis.DataSet(Array.from(nodesMap.values()));
    const edgesData = new vis.DataSet(Array.from(edgesMap.values()));

    const data = { nodes: nodesData, edges: edgesData };
    
    const options = {
        physics: {
            forceAtlas2Based: {
                gravitationalConstant: -26,
                centralGravity: 0.005,
                springLength: 230,
                springConstant: 0.18
            },
            maxVelocity: 50,
            solver: 'forceAtlas2Based',
            timestep: 0.35,
            stabilization: { iterations: 150 }
        },
        edges: {
            smooth: { type: 'continuous' },
            color: '#30363d',
            arrows: { to: { enabled: true, scaleFactor: 0.5 } }
        }
    };

    if (network !== null) {
        network.destroy();
    }
    
    network = new vis.Network(container, data, options);
}

// Draw initial empty state text
document.getElementById('mynetwork').innerHTML = '<div style="display:flex; height:100%; align-items:center; justify-content:center; color:#8b949e; font-size:1.2rem;">Select a query on the left to explore the Knowledge Graph</div>';
