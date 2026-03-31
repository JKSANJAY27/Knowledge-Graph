// Knowledge Graph Reasoning Queries
// Domain: Research Publications (NLP focus)
// Data sourced from OpenAlex API
// Run these in Neo4j Browser one at a time
// ================================================


// ── QUERY 1: Basic Traversal ──────────────────────────────────────────────────
// "Find all authors working in Natural Language Processing"
// Reasoning type: Direct 2-hop traversal  Author->Paper->Concept
// This is the most basic form of graph reasoning — following edges to infer
// a property of a node (what field an author works in) that isn't stored
// directly on the author node itself.

MATCH (a:Author)-[:WRITES]->(p:Paper)-[:BELONGS_TO]->(c:Concept)
WHERE c.name IS NOT NULL
RETURN DISTINCT a.name AS Author, p.title AS Paper, c.name AS Field
ORDER BY a.name
LIMIT 30;


// ── QUERY 2: Institution-level field mapping ───────────────────────────────────
// "Which institutions are publishing NLP research?"
// Reasoning: 3-hop traversal  Institution<-Author->Paper->Concept
// Demonstrates that you can infer institution-level research focus
// purely from individual author affiliations — no direct inst->field edge exists.

MATCH (i:Institution)<-[:AFFILIATED_WITH]-(a:Author)-[:WRITES]->(p:Paper)-[:BELONGS_TO]->(c:Concept)
WHERE c.name IS NOT NULL
RETURN DISTINCT i.name AS Institution, i.country AS Country, count(DISTINCT a) AS NLPAuthors
ORDER BY NLPAuthors DESC
LIMIT 20;


// ── QUERY 3: Co-author discovery ──────────────────────────────────────────────
// "Find all co-author pairs in the dataset"
// Reasoning: Symmetric pattern — two authors share an edge to the same paper node.
// This is a classic graph structural inference: collaboration is implied
// by shared participation, not by an explicit COLLABORATES_WITH edge.

MATCH (a1:Author)-[:WRITES]->(p:Paper)<-[:WRITES]-(a2:Author)
WHERE id(a1) < id(a2)
RETURN a1.name AS Author1, a2.name AS Author2, p.title AS SharedPaper, p.year AS Year
ORDER BY p.year DESC
LIMIT 25;


// ── QUERY 4: Indirect relationship — same field, different university ─────────
// "Find researchers working in the same concept area but from different institutions"
// Reasoning type: INDIRECT INFERENCE — the relationship "works in same field" is
// never stored in the database. It is *derived* by finding a shared Concept node
// that two authors reach via different paths. This is the core of graph-based
// semantic reasoning.

MATCH (a1:Author)-[:AFFILIATED_WITH]->(i1:Institution)
MATCH (a1)-[:WRITES]->(p1:Paper)-[:BELONGS_TO]->(c:Concept)
MATCH (c)<-[:BELONGS_TO]-(p2:Paper)<-[:WRITES]-(a2:Author)
MATCH (a2)-[:AFFILIATED_WITH]->(i2:Institution)
WHERE id(a1) < id(a2)
  AND i1.name <> i2.name
RETURN a1.name        AS Researcher1,
       i1.name        AS University1,
       c.name         AS SharedField,
       a2.name        AS Researcher2,
       i2.name        AS University2
ORDER BY c.name
LIMIT 25;


// ── QUERY 5: Cross-disciplinary / interdisciplinary authors ───────────────────
// "Find authors who publish across 3 or more distinct research fields"
// Reasoning: Aggregation-based inference. The label "interdisciplinary" does not
// exist in the database — it is computed at query time by counting distinct
// concept nodes reachable from each author through their papers.

MATCH (a:Author)-[:WRITES]->(p:Paper)-[:BELONGS_TO]->(c:Concept)
WITH a, collect(DISTINCT c.name) AS fields
WHERE size(fields) >= 3
RETURN a.name AS Author, size(fields) AS FieldCount, fields AS ResearchFields
ORDER BY FieldCount DESC
LIMIT 20;


// ── QUERY 6: Most influential papers (citation count) ─────────────────────────
// "Which papers have the most real-world citations (from OpenAlex data)?"
// Also counts in-graph CITES relationships as a secondary metric.
// Reasoning: Centrality-based — high citation count indicates higher influence
// in the knowledge network.

MATCH (p:Paper)
OPTIONAL MATCH (:Paper)-[r:CITES]->(p)
WITH p, count(r) AS inGraphCitations
RETURN p.title          AS Paper,
       p.year           AS Year,
       p.citations      AS GlobalCitations,
       inGraphCitations AS CitedInSample
ORDER BY GlobalCitations DESC
LIMIT 15;


// ── QUERY 7: Citation chain — papers that cite AND are cited (hubs) ───────────
// "Find papers that both cite others and are cited by others in our dataset"
// Reasoning: Structural pattern — these nodes are 'hub' nodes in the citation
// subgraph, which often represent landmark/survey-type works.

MATCH (source:Paper)-[:CITES]->(hub:Paper)-[:CITES]->(target:Paper)
RETURN DISTINCT hub.title AS HubPaper, hub.year AS Year, hub.citations AS GlobalCitations
ORDER BY hub.citations DESC
LIMIT 15;


// ── QUERY 8: Potential collaborator recommendation ────────────────────────────
// "Suggest co-authorship candidates: authors in same field who've never co-authored"
// Reasoning: Negative pattern matching with WHERE NOT — finds structurally
// compatible pairs (same field) while filtering out pairs that already have
// a direct link. This is recommendation-via-graph-traversal.

MATCH (a1:Author)-[:WRITES]->(p1:Paper)-[:BELONGS_TO]->(c:Concept)
      <-[:BELONGS_TO]-(p2:Paper)<-[:WRITES]-(a2:Author)
WHERE id(a1) < id(a2)
  AND NOT EXISTS {
        MATCH (a1)-[:WRITES]->(:Paper)<-[:WRITES]-(a2)
      }
RETURN a1.name  AS Candidate1,
       a2.name  AS Candidate2,
       c.name   AS SharedField
LIMIT 20;


// ── QUERY 9: Country-level research output ────────────────────────────────────
// "Which countries produce the most NLP research (by paper count)?"
// Reasoning: Multi-hop aggregation across 4 node types in one traversal.

MATCH (i:Institution)<-[:AFFILIATED_WITH]-(a:Author)-[:WRITES]->(p:Paper)
      -[:BELONGS_TO]->(c:Concept)
WHERE c.name IS NOT NULL
  AND i.country <> 'Unknown'
RETURN i.country AS Country, count(DISTINCT p) AS PaperCount
ORDER BY PaperCount DESC
LIMIT 15;


// ── QUERY 10: Full subgraph around a specific concept ─────────────────────────
// "Show the complete knowledge subgraph around 'Natural language processing'"
// Useful for graph visualization in Neo4j Browser (use graph mode, not table mode)
// Reasoning: Holistic path enumeration — returns all connected nodes for viz.

MATCH path = (i:Institution)<-[:AFFILIATED_WITH]-(a:Author)
             -[:WRITES]->(p:Paper)-[:BELONGS_TO]->(c:Concept)
WHERE c.name IS NOT NULL
RETURN path
LIMIT 60;

