# 🕸️ Neo4j GraphReasoner: NLP Research Knowledge Graph

**GraphReasoner** is an end-to-end, highly interactive Knowledge Graph application designed to map, traverse, and extract deep relational insights from real-world **Natural Language Processing (NLP) Research Publications**.

Powered by a **Neo4j** graph database, an **Express/Node.js** backend, and a custom physics-simulated **vis-network** frontend, this project moves far beyond simple table lookups. It utilizes true **Graph-Based Reasoning** to uncover hidden patterns, indirect affiliations, and structural centralities across academic authors, papers, institutions, and concepts.

To top it off, it features an integrated **Ollama Graph RAG Chatbot** powered by `llama3.2:3b` that translates natural language inquiries into Cypher queries, retrieves the sub-graph, and visualizes the exact logic pathing right inside the chat window!

---

## ✨ Core Features

### 🌌 1. OpenAlex Data Pipeline (Real-World Data)
- Dynamically fetches, sanitizes, and maps large volumes of interconnected NLP research data from the **OpenAlex API** natively into CSVs perfectly formatted for Neo4j consumption.
- Graph Topology includes `(Author)-[:WRITES]->(Paper)-[:BELONGS_TO]->(Concept)`, `[:AFFILIATED_WITH]->(Institution)`, and `[:CITES]->(Paper)`.

### 🧠 2. 10-Tiered Analytical Cypher Engine
GraphReasoner includes 10 complex, heavily-optimized Cypher operations directly bound to the UI to demonstrate specific types of reasoning:
* **Direct Traversal**: Fetching direct `Author ↔ Paper` chains.
* **Multi-hop / Structural Inference**: "Find co-authors who have never directly collaborated but share a mutual collaborator."
* **Indirect Inference**: "Find researchers who work in the exact same field, but belong to entirely completely different, unconnected universities."
* **Centrality & Ecosystem Hubs**: Identifying the most structurally critical papers (highest in-degree citation count) tying the graph together.
* **Negative Pattern Filtering (Collaborator Recommendations)**: Searching for highly compatible candidates by traversing 3 hops deep while specifically excluding direct previous relationships.

### 🎨 3. Flawless Interactive Visualizer
A 100% custom-built Vanilla JS frontend mapping the complex JSON outputs from Neo4j natively into draggable, zoomable, physics-simulated canvases via `vis-network`.
* Instantly switches between structured data metrics (Table) and relational topologies (Graph) without redundant API calls.

### 🤖 4. "Next-Gen" Ollama Graph RAG Chatbot
- Run natural language queries directly against your local graph. The system uses **LLaMA 3.2 (3B)** via Ollama to translate English questions into executable **Cypher Query Language**.
- **Semantic Auto-Correction**: Employs an intelligent Node.js interception routing layer to prevent the small 3B model from hallucinating non-existent database properties (like broken text filters or invalid syntaxes), enforcing strict structural success.
- **Embedded Vis-Network Feedback**: Whenever the LLM answers your question, the frontend seamlessly intercepts the exact graph subset the Database returned and instantly generates a **custom, physics-based mini-graph directly inside the Chat Bubble**. You can physically see the branches the AI traversed to give you the answer!

---

## 🛠️ Tech Stack

- **Database Engine**: Neo4j Desktop / Cypher
- **Backend API**: Node.js, Express.js, `neo4j-driver`
- **Generative AI / RAG**: Local Ollama Server (`llama3.2:3b`)
- **Telemetry & Monitoring**: Langfuse SDK, Structured JSON Logs
- **Frontend App**: Pure HTML5, CSS3 (CSS Variables for dynamic theming), Vanilla JavaScript
- **Visualization Tool**: `vis-network` (Canvas Network Physics)

---

## 📊 Telemetry & Monitoring

GraphReasoner is equipped with an enterprise-grade tracing and structured logging engine right out of the box, capable of observing nested logic paths from the HTTP layer all the way down to the graph database and LLM inference.

- **Langfuse Distributed Tracing**: Every API request (`/api/query`, `/api/chat`, `/api/graph`) automatically starts a root trace. Neo4j graph queries and Ollama LLM queries are accurately recorded as nested child \`span\`s and \`generation\`s bound seamlessly to the parent request, capturing exact latency, rows matched, and token estimates.
- **Structured JSON Logging**: Forget messy console strings. All Node.js backend output is securely formatted as strict JSON payloads containing ISO timestamps, making it trivial for log scrapers like Promtail/Loki to ingest stdout strictly for Grafana dashboards.
- **Built-in Alert System**: The `telemetry.js` module actively evaluates hard thresholds on the fly. It pushes `ALERT`-level logs locally for scenarios like:
  - Slow DB Queries (> 1500ms)
  - Sluggish Chatbot Generations (> 10s)
  - Endpoints resolving with 500 server error codes
  - Undersaturated graph visualizer payload returns (< 2 nodes)

---

## 🚀 Getting Started

### 1. Requirements
* Node.js (v18+)
* Neo4j Desktop (v5+)
* Ollama installed locally with `llama3.2:3b` pulled (`ollama run llama3.2:3b`)

### 2. Database Setup
1. Create a Neo4j Database on port `7687`. Set the password exactly to `password123` (or update your `.env` file).
2. Run `node setup/fetch_dataset.js` to build the CSV import structures from OpenAlex.
3. Import the CSVs into your active Neo4j Database.
4. (Optional) You can verify the reasoning algorithms directly within Neo4j by pasting the queries from `setup/03_queries.cypher`.

### 3. Running the Dashboard
1. Open a terminal in the root directory.
2. Ensure your `.env` contains:
   \`\`\`env
   NEO4J_URI=bolt://localhost:7687
   NEO4J_USER=neo4j
   NEO4J_PASSWORD=password123
   PORT=3000
   \`\`\`
3. Run \`npm start\`.
4. Open your browser to \`http://localhost:3000\`.
5. Start reasoning! Click **Q10 (Full NLP Subgraph)** to populate the visual engine, and tab into the **Graph RAG** view to ask questions.

---
*Built as a state-of-the-art demonstration of bridging Graph Databases with Retrieval-Augmented Generation (RAG) capabilities.*
