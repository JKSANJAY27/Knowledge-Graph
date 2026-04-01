require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const neo4j   = require('neo4j-driver');
const path    = require('path');
const { langfuse, logger, wrapNeo4jSession, wrapOllamaCall, THRESHOLDS } = require('./telemetry');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../web')));

// Telemetry Middleware: Create root trace for every request
app.use((req, res, next) => {
    const start = Date.now();
    // Start Langfuse trace
    req.trace = langfuse.trace({
        name: `${req.method} ${req.path}`,
        metadata: { path: req.path, method: req.method }
    });

    res.on('finish', () => {
        const latency = Date.now() - start;
        req.trace.update({
            metadata: { path: req.path, method: req.method, status: res.statusCode, latency_ms: latency }
        });
        
        logger.info('API_REQUEST', `${req.method} ${req.path} ${res.statusCode}`, {
            path: req.path, method: req.method, status: res.statusCode, latency_ms: latency
        });

        if (res.statusCode >= 500) {
            logger.alert('HIGH_API_ERROR_RATE', `API Endpoint Error Status: ${res.statusCode}`, { path: req.path });
        }
    });
    next();
});

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
            WHERE c.name IS NOT NULL
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
            WHERE c.name IS NOT NULL
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
            WHERE c.name IS NOT NULL
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
            WHERE c.name IS NOT NULL
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
        const records = await wrapNeo4jSession(session, cypher, req.trace, `Query: ${queryKey || 'Custom'}`);
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
        const records = await wrapNeo4jSession(session, q.cypher, req.trace, `Graph: ${req.body.queryKey}`);
        
        if (records.length < THRESHOLDS.EMPTY_VISUALIZER_NODES) {
            logger.alert('EMPTY_VISUALIZER', `Visualizer query returned < ${THRESHOLDS.EMPTY_VISUALIZER_NODES} nodes.`, { queryKey: req.body.queryKey });
        }
        res.json({ success: true, records, label: q.label });
    } catch (e) {
        res.status(500).json({ error: e.message });
    } finally {
        await session.close();
    }
});


// ── Ollama RAG Chatbot Integration ───────────────────────────────────────────
const OLLAMA_MODEL = 'llama3.2:3b'; // Local model found in your ollama list


app.post('/api/chat', async (req, res) => {
    const { question } = req.body;
    if (!question) return res.status(400).json({ error: 'Question is required' });

    try {
        const qLow = question.toLowerCase();
        let cypher = '';
        
        // ── Semantic Routing (Fallback for small 3B LLM capabilities) ──
        if (qLow.includes('different universit') || qLow.includes('different institution')) {
            cypher = `MATCH (a1:Author)-[:WRITES]->(p1:Paper)-[:BELONGS_TO]->(c:Concept)<-[:BELONGS_TO]-(p2:Paper)<-[:WRITES]-(a2:Author)
MATCH (a1)-[:AFFILIATED_WITH]->(i1:Institution), (a2)-[:AFFILIATED_WITH]->(i2:Institution)
WHERE id(a1) < id(a2) AND i1.name <> i2.name AND c.name IS NOT NULL
RETURN a1.name AS Researcher1, i1.name AS Uni1, a2.name AS Researcher2, i2.name AS Uni2, c.name AS SharedConcept LIMIT 15`;
        } else {
            // Step 1: Text to Cypher using LLM
        const schemaPrompt = `Given a Neo4j database with the following schema:
Nodes: 
- Author {id: String, name: String}
- Paper {id: String, title: String, year: Int, citations: Int}
- Concept {id: String, name: String}
- Institution {id: String, name: String, country: String}

Relationships:
- (:Author)-[:WRITES]->(:Paper)
- (:Author)-[:AFFILIATED_WITH]->(:Institution)
- (:Paper)-[:BELONGS_TO]->(:Concept)
- (:Paper)-[:CITES]->(:Paper)

Translate the following user question into a valid Cypher query that can answer the question.
IMPORTANT RULES:
1. Return ONLY the Cypher query text, enclosed in backticks (\`\`\`cypher ... \`\`\`). Do NOT provide any explanation.
2. Use \`toLower()\` and \`CONTAINS\` for string matching against names or titles instead of exact matches where possible. 
3. DO NOT hallucinate exact names unless explicitly mentioned in the question.
4. IMPORTANT: This entire database is locally built strictly from NLP research papers. If the user asks for "natural language processing" or "NLP", DO NOT add a WHERE clause checking \`c.name CONTAINS 'natural language processing'\`. That exact string is missing in the OpenAlex mappings and it will break the query. Just assume all fetched nodes are NLP.

Example 1: Find researchers who work in natural language processing but belong to different universities.
\`\`\`cypher
MATCH (a1:Author)-[:AFFILIATED_WITH]->(i1:Institution)
MATCH (a1)-[:WRITES]->(p1:Paper)-[:BELONGS_TO]->(c:Concept)
MATCH (c)<-[:BELONGS_TO]-(p2:Paper)<-[:WRITES]-(a2:Author)
MATCH (a2)-[:AFFILIATED_WITH]->(i2:Institution)
WHERE c.name IS NOT NULL 
  AND id(a1) < id(a2) AND i1.name <> i2.name
RETURN a1.name AS Researcher1, i1.name AS Uni1, a2.name AS Researcher2, i2.name AS Uni2 LIMIT 20
\`\`\`

Question: ${question}`;

        const cypherGen = await wrapOllamaCall(schemaPrompt, OLLAMA_MODEL, req.trace, 'LLM Text2Cypher');
        
            const match = cypherGen.match(/\`\`\`(?:cypher)?\n([\s\S]*?)\n\`\`\`/i);
            if (match && match[1]) {
                cypher = match[1];
            }
        }

        // --- Step 2: Execute Cypher ---
        const session = driver.session();
        let dbRecords = [];
        let queryError = null;
        try {
            dbRecords = await wrapNeo4jSession(session, cypher, req.trace, 'RAG Subgraph Retrieval');
        } catch(e) {
            queryError = e.message;
        } finally {
            await session.close();
        }

        // Step 3: Natural Language Response
        const contextJSON = JSON.stringify(dbRecords, null, 2);
        const answerPrompt = `You are a helpful expert knowledge graph assistant. The user asked a question about a research publications knowledge graph.
Here is the raw data result retrieved from the database to answer their question (in JSON format):
\`\`\`json
${contextJSON}
\`\`\`
${queryError ? `Note: The database returned an error: ${queryError}` : ''}

Based on this data, provide a concise, natural language answer directly answering their question. If the data is empty or irrelevant, politely inform them. Do not include the JSON data in your answer, just summarize it clearly.

Question: ${question}`;

        const answerGen = await wrapOllamaCall(answerPrompt, OLLAMA_MODEL, req.trace, 'LLM Natural Language Response');

        res.json({
            success: true,
            question,
            cypher,
            records: dbRecords,
            answer: answerGen.trim()
        });

    } catch (e) {
        console.error('Text2Cypher Error:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running → http://localhost:${PORT}`));
