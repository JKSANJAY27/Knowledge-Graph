// 1. Create Constraints to ensure unique IDs and improve import performance
CREATE CONSTRAINT FOR (p:Paper) REQUIRE p.id IS UNIQUE;
CREATE CONSTRAINT FOR (a:Author) REQUIRE a.id IS UNIQUE;
CREATE CONSTRAINT FOR (i:Institution) REQUIRE i.id IS UNIQUE;
CREATE CONSTRAINT FOR (c:Concept) REQUIRE c.id IS UNIQUE;

// 2. Clear existing database (WARNING: destructive, useful for reloading during development)
// MATCH (n) DETACH DELETE n;
