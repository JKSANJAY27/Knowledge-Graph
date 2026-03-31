// --- 1. Basic Traversal ---
// Query 1: Find all Authors working in the field of "Natural language processing"
MATCH (a:Author)-[:WRITES]->(p:Paper)-[:BELONGS_TO]->(c:Concept)
WHERE toLower(c.name) CONTAINS "natural language processing"
RETURN DISTINCT a.name AS Author, c.name AS Concept
LIMIT 30;

// Query 2: Find all Papers associated with "Machine learning" concepts
MATCH (p:Paper)-[:BELONGS_TO]->(c:Concept)
WHERE toLower(c.name) CONTAINS "machine learning"
RETURN p.title AS Title, p.year AS Year, c.name AS Concept
LIMIT 20;

// --- 2. Indirect Relationship & Inference ---
// Query 3: Find researchers who work in the same field but belong to different universities
// This demonstrates logical reasoning by discovering a commonality (Field) across divergent contexts (Universities)
MATCH (a1:Author)-[:WRITES]->(p1:Paper)-[:BELONGS_TO]->(c:Concept)
MATCH (a2:Author)-[:WRITES]->(p2:Paper)-[:BELONGS_TO]->(c)
MATCH (a1)-[:AFFILIATED_WITH]->(i1:Institution)
MATCH (a2)-[:AFFILIATED_WITH]->(i2:Institution)
WHERE id(a1) < id(a2) AND id(i1) <> id(i2) // Ensure different users and different universities
RETURN a1.name, i1.name, c.name AS SharedField, a2.name, i2.name
LIMIT 25;

// --- 3. Collaboration Network ---
// Query 4: Find Co-Authors (Authors who wrote the same paper)
MATCH (a1:Author)-[:WRITES]->(Paper)<-[:WRITES]-(a2:Author)
WHERE id(a1) < id(a2)
RETURN a1.name AS Author1, a2.name AS Author2, Paper.title AS SharedPaper
LIMIT 20;

// --- 4. Cross-Disciplinary Reasoning ---
// Query 5: Find Authors who publish across multiple different concepts (Interdisciplinary researchers)
MATCH (a:Author)-[:WRITES]->(:Paper)-[:BELONGS_TO]->(c:Concept)
WITH a, collect(DISTINCT c.name) AS Fields
WHERE size(Fields) >= 3             // Author works in 3 or more concepts
RETURN a.name, Fields
LIMIT 20;

// --- 5. Citation Network & Influence ---
// Query 6: Find the most influential papers in the dataset (Most CITES incoming links)
MATCH (p:Paper)
OPTIONAL MATCH (:Paper)-[r:CITES]->(p)
// We also use the `citations` property from OpenAlex, but let's see in-graph links too
WITH p, count(r) AS inGraphCitations
ORDER BY inGraphCitations DESC, p.citations DESC
RETURN p.title AS Paper, p.year AS Year, p.citations AS GlobalCitations, inGraphCitations
LIMIT 10;
