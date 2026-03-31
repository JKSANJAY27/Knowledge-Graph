// Run these queries ONE AT A TIME in the Neo4j Browser

// 1. Create Nodes
LOAD CSV WITH HEADERS FROM "file:///papers.csv" AS row
MERGE (p:Paper {id: row.id})
SET p.title = row.title,
    p.year = toInteger(row.year),
    p.citations = toInteger(row.citations);

LOAD CSV WITH HEADERS FROM "file:///authors.csv" AS row
MERGE (a:Author {id: row.id})
SET a.name = row.name;

LOAD CSV WITH HEADERS FROM "file:///institutions.csv" AS row
MERGE (i:Institution {id: row.id})
SET i.name = row.name,
    i.country = row.country;

LOAD CSV WITH HEADERS FROM "file:///concepts.csv" AS row
MERGE (c:Concept {id: row.id})
SET c.name = row.name;


// 2. Create Relationships
LOAD CSV WITH HEADERS FROM "file:///writes.csv" AS row
MATCH (a:Author {id: row.authorId})
MATCH (p:Paper {id: row.paperId})
MERGE (a)-[:WRITES]->(p);

LOAD CSV WITH HEADERS FROM "file:///affiliated_with.csv" AS row
MATCH (a:Author {id: row.authorId})
MATCH (i:Institution {id: row.instId})
MERGE (a)-[:AFFILIATED_WITH]->(i);

LOAD CSV WITH HEADERS FROM "file:///belongs_to.csv" AS row
MATCH (p:Paper {id: row.paperId})
MATCH (c:Concept {id: row.conceptId})
MERGE (p)-[:BELONGS_TO]->(c);

LOAD CSV WITH HEADERS FROM "file:///cites.csv" AS row
MATCH (p1:Paper {id: row.paperId})
MATCH (p2:Paper {id: row.citedPaperId})
MERGE (p1)-[:CITES]->(p2);
