require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const neo4j   = require('neo4j-driver');
const path    = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../web')));

// ── Neo4j connection ──────────────────────────────────────────────────────────
const driver = neo4j.driver(
    process.env.NEO4J_URI      || 'bolt://localhost:7687',
    neo4j.auth.basic(
        process.env.NEO4J_USER     || 'neo4j',
        process.env.NEO4J_PASSWORD || 'password123'
    )
);

driver.verifyConnectivity()
    .then(() => console.log('✓ Connected to Neo4j'))
    .catch(e  => console.error('✗ Neo4j connection failed:', e.message));

process.on('SIGINT',  () => driver.close().then(() => process.exit()));
process.on('SIGTERM', () => driver.close().then(() => process.exit()));

// ── Named queries ─────────────────────────────────────────────────────────────
const QUERIES = {

    // Q1 — direct 2-hop traversal
    nlp_authors: {
        label: 'NLP Authors (direct traversal)',
        description: 'Follows Author→Paper→Concept to find all researchers in NLP without any explicit author→field link.',
        cypher: `
            MATCH (a:Author)-[:WRITES]->(p:Paper)-[:BELONGS_TO]->(c:Concept)
            WHERE toLower(c.name) CONTAINS 'natural language processing'
            RETURN DISTINCT a.name AS Author, p.title AS Paper, c.name AS Field
            ORDER BY a.name
            LIMIT 30
        `
    },

    // Q2 — 3-hop institution-level inference
    nlp_institutions: {
        label: 'NLP Institutions (3-hop inference)',
        description: 'Infers institution research focus by traversing 3 hops — no direct institution→field edge exists.',
        cypher: `
            MATCH (i:Institution)<-[:AFFILIATED_WITH]-(a:Author)
                  -[:WRITES]->(p:Paper)-[:BELONGS_TO]->(c:Concept)
            WHERE toLower(c.name) CONTAINS 'natural language processing'
            RETURN DISTINCT i.name AS Institution,
                   i.country AS Country,
                   count(DISTINCT a) AS NLPAuthors
            ORDER BY NLPAuthors DESC
            LIMIT 20
        `
    },

    // Q3 — symmetric co-author structural pattern
    coauthors: {
        label: 'Co-author Pairs (structural inference)',
        description: 'Collaboration is never stored explicitly — it is inferred when two authors share an edge to the same paper node.',
        cypher: `
            MATCH (a1:Author)-[:WRITES]->(p:Paper)<-[:WRITES]-(a2:Author)
            WHERE id(a1) < id(a2)
            RETURN a1.name AS Author1, a2.name AS Author2,
                   p.title AS SharedPaper, p.year AS Year
            ORDER BY p.year DESC
            LIMIT 25
        `
    },

    // Q4 — indirect inference: same field, different institution
    same_field_diff_uni: {
        label: 'Same Field, Different Institution (indirect inference)',
        description: 'The "works in same field" relationship is never stored — it is derived by finding a shared Concept node reached via different paths.',
        cypher: `
            MATCH (a1:Author)-[:AFFILIATED_WITH]->(i1:Institution)
            MATCH (a1)-[:WRITES]->(p1:Paper)-[:BELONGS_TO]->(c:Concept)
            MATCH (c)<-[:BELONGS_TO]-(p2:Paper)<-[:WRITES]-(a2:Author)
            MATCH (a2)-[:AFFILIATED_WITH]->(i2:Institution)
            WHERE id(a1) < id(a2) AND i1.name <> i2.name
            RETURN a1.name AS Researcher1, i1.name AS University1,
                   c.name  AS SharedField,
                   a2.name AS Researcher2, i2.name AS University2
            ORDER BY c.name
            LIMIT 25
        `
    },

    // Q5 — aggregation pattern: interdisciplinary authors
    interdisciplinary: {
        label: 'Interdisciplinary Authors (aggregation)',
        description: 'The label "interdisciplinary" does not exist in the DB — it is computed at query time by counting distinct concept nodes reachable from each author.',
        cypher: `
            MATCH (a:Author)-[:WRITES]->(:Paper)-[:BELONGS_TO]->(c:Concept)
            WITH a, collect(DISTINCT c.name) AS fields
            WHERE size(fields) >= 3
            RETURN a.name AS Author, size(fields) AS FieldCount, fields AS ResearchFields
            ORDER BY FieldCount DESC
            LIMIT 20
        `
    },

    // Q6 — centrality: most cited papers
    most_cited: {
        label: 'Most Influential Papers (centrality)',
        description: 'Ranks papers by global citation count from OpenAlex plus in-graph CITES edges — measures influence via node centrality.',
        cypher: `
            MATCH (p:Paper)
            OPTIONAL MATCH (:Paper)-[r:CITES]->(p)
            WITH p, count(r) AS inGraphCitations
            RETURN p.title AS Paper, p.year AS Year,
                   p.citations AS GlobalCitations,
                   inGraphCitations AS CitedInSample
            ORDER BY GlobalCitations DESC
            LIMIT 15
        `
    },

    // Q7 — structural hub detection in citation network
    citation_hubs: {
        label: 'Citation Hub Papers (structural hub)',
        description: 'Finds papers that both cite others AND are cited — these 2-hop "bridges" in the citation graph are often landmark survey papers.',
        cypher: `
            MATCH (src:Paper)-[:CITES]->(hub:Paper)-[:CITES]->(tgt:Paper)
            RETURN DISTINCT hub.title AS HubPaper, hub.year AS Year,
                   hub.citations AS GlobalCitations
            ORDER BY hub.citations DESC
            LIMIT 15
        `
    },

    // Q8 — negative pattern: collaborator recommendation
    recommend_collaborators: {
        label: 'Collaborator Recommendations (negative pattern)',
        description: 'Uses WHERE NOT EXISTS to find structurally compatible pairs (same field) who have never co-authored — classic graph-based recommendation.',
        cypher: `
            MATCH (a1:Author)-[:WRITES]->(p1:Paper)-[:BELONGS_TO]->(c:Concept)
                  <-[:BELONGS_TO]-(p2:Paper)<-[:WRITES]-(a2:Author)
            WHERE id(a1) < id(a2)
              AND NOT EXISTS {
                    MATCH (a1)-[:WRITES]->(:Paper)<-[:WRITES]-(a2)
                  }
            RETURN a1.name AS Candidate1, a2.name AS Candidate2,
                   c.name AS SharedField
            LIMIT 20
        `
    },

    // Q9 — multi-hop aggregation by country
    country_output: {
        label: 'Country Research Output (multi-hop aggregation)',
        description: 'Aggregates NLP paper count across 4 node types in a single traversal — no country→field relationship exists directly.',
        cypher: `
            MATCH (i:Institution)<-[:AFFILIATED_WITH]-(a:Author)
                  -[:WRITES]->(p:Paper)-[:BELONGS_TO]->(c:Concept)
            WHERE toLower(c.name) CONTAINS 'natural language processing'
              AND i.country <> 'Unknown'
            RETURN i.country AS Country, count(DISTINCT p) AS PaperCount
            ORDER BY PaperCount DESC
            LIMIT 15
        `
    },

    // Q10 — path enumeration for full graph visualization
    full_subgraph: {
        label: 'Full NLP Subgraph (path enumeration)',
        description: 'Returns all Author→Paper→Concept paths for NLP — designed to feed the graph visualizer.',
        cypher: `
            MATCH (a:Author)-[:WRITES]->(p:Paper)-[:BELONGS_TO]->(c:Concept)
            WHERE toLower(c.name) CONTAINS 'natural language processing'
            WITH a, p, c LIMIT 50
            RETURN a.id AS aId, a.name AS aName,
                   p.id AS pId, p.title AS pTitle,
                   c.id AS cId, c.name AS cName
        `
    }
};

// ── Routes ────────────────────────────────────────────────────────────────────

// list all query keys + metadata (used by frontend to build the sidebar)
app.get('/api/queries', (_req, res) => {
    const list = Object.entries(QUERIES).map(([key, q]) => ({
        key,
        label: q.label,
        description: q.description
    }));
    res.json(list);
});

// run any named query, return flat records (for the table view)
app.post('/api/query', async (req, res) => {
    const { queryKey, customCypher } = req.body;
    const cypher = QUERIES[queryKey]?.cypher ?? customCypher;
    if (!cypher) return res.status(400).json({ error: 'No query provided.' });

    const session = driver.session();
    try {
        const result  = await session.run(cypher);
        const records = result.records.map(r => {
            const obj = {};
            r.keys.forEach(k => {
                const val = r.get(k);
                obj[k] = neo4j.isInt(val) ? val.toNumber() : val;
            });
            return obj;
        });
        res.json({
            success: true,
            records,
            label: QUERIES[queryKey]?.label ?? 'Custom Query',
            description: QUERIES[queryKey]?.description ?? ''
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    } finally {
        await session.close();
    }
});

// graph endpoint — returns raw records for vis-network (Q10 specifically)
app.post('/api/graph', async (req, res) => {
    const q = QUERIES[req.body.queryKey];
    if (!q) return res.status(400).json({ error: 'Unknown query key' });

    const session = driver.session();
    try {
        const result = await session.run(q.cypher);
        const records = result.records.map(r => {
            const obj = {};
            r.keys.forEach(k => {
                const val = r.get(k);
                obj[k] = neo4j.isInt(val) ? val.toNumber() : val;
            });
            return obj;
        });
        res.json({ success: true, records, label: q.label });
    } catch (e) {
        res.status(500).json({ error: e.message });
    } finally {
        await session.close();
    }
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running → http://localhost:${PORT}`));
