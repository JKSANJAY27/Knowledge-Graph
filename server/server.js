require('dotenv').config();
const express = require('express');
const cors = require('cors');
const neo4j = require('neo4j-driver');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Serve static frontend
app.use(express.static(path.join(__dirname, '../web')));

// Neo4j Driver Setup (Requires .env file)
const DB_URI = process.env.NEO4J_URI || 'bolt://localhost:7687';
const DB_USER = process.env.NEO4J_USER || 'neo4j';
const DB_PASS = process.env.NEO4J_PASSWORD || 'password123'; // Default password to change

let driver;
try {
    driver = neo4j.driver(DB_URI, neo4j.auth.basic(DB_USER, DB_PASS));
    console.log("Connected to Neo4j successfully!");
} catch (error) {
    console.error("Failed to connect to Neo4j. Check database status.", error);
}

// Ensure driver is closed on exit
process.on('exit', () => driver.close());

// Pre-defined Queries
const QUERIES = {
    nlp_authors: `
        MATCH (a:Author)-[:WRITES]->(p:Paper)-[:BELONGS_TO]->(c:Concept)
        WHERE toLower(c.name) CONTAINS "natural language processing"
        RETURN a { .id, .name, label: "Author" } AS source,
               p { .id, .title, label: "Paper" } AS target,
               { type: "WRITES" } AS rel,
               c { .id, .name, label: "Concept" } AS endNode,
               { type: "BELONGS_TO" } AS rel2
        LIMIT 50;
    `,
    same_field_different_uni: `
        MATCH (a1:Author)-[:AFFILIATED_WITH]->(i1:Institution)
        MATCH (a1)-[:WRITES]->(:Paper)-[:BELONGS_TO]->(c:Concept)
        MATCH (c)<-[:BELONGS_TO]-(:Paper)<-[:WRITES]-(a2:Author)
        MATCH (a2)-[:AFFILIATED_WITH]->(i2:Institution)
        WHERE id(a1) < id(a2) AND id(i1) <> id(i2)
        
        // Build sub-graph for visualization
        RETURN a1 { .id, .name, label:"Author" } AS n1,
               i1 { .id, .name, label:"Institution" } AS i1_node,
               { type: "AFFILIATED_WITH" } AS rel1,
               c  { .id, .name, label:"Concept" } AS concept,
               { type: "SAME_FIELD_AS" } AS rel2,  // Virtual edge for reasoning visualization
               a2 { .id, .name, label:"Author" } AS n2,
               i2 { .id, .name, label:"Institution" } AS i2_node,
               { type: "AFFILIATED_WITH" } AS rel3
               
        LIMIT 25;
    `,
    interdisciplinary: `
        MATCH (a:Author)-[:WRITES]->(:Paper)-[:BELONGS_TO]->(c:Concept)
        WITH a, collect(DISTINCT c) AS fields
        WHERE size(fields) >= 3
        
        // Return author and all their fields
        UNWIND fields AS field
        RETURN a { .id, .name, label:"Author" } AS source,
               field { .id, .name, label:"Concept" } AS target,
               { type: "RESEARCHES_IN" } AS rel
        LIMIT 40;
    `
};

app.post('/api/query', async (req, res) => {
    const { queryKey, customCypher } = req.body;
    let cypher = QUERIES[queryKey] || customCypher;
    
    if (!cypher) return res.status(400).json({ error: "Missing query parameter." });

    const session = driver.session();
    try {
        const result = await session.run(cypher);
        const records = result.records.map(r => r.toObject());
        res.json({ success: true, records });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    } finally {
        await session.close();
    }
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
});
