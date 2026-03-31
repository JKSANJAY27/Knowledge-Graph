# Knowledge Graph Reasoning with Neo4j

## Domain Description
This project focuses on the **Research Publications** domain. It automatically extracts real-world data from the open internet (via the OpenAlex API) specifically focused on **Natural Language Processing (NLP)**. 

### Entities (Nodes)
* `Author`: Researchers who publish papers
* `Paper`: Academic publications
* `Institution`: Universities or companies authors are affiliated with
* `Concept`: Fields of study (e.g., Natural Language Processing)

### Relationships (Edges)
* `(Author)-[:WRITES]->(Paper)`
* `(Author)-[:AFFILIATED_WITH]->(Institution)`
* `(Paper)-[:BELONGS_TO]->(Concept)`
* `(Paper)-[:CITES]->(Paper)`

---

## 🚀 Setup Instructions (Windows)

Since you don't have Neo4j set up, follow these steps exactly to get everything running locally on your machine.

### Step 1: Install Neo4j Desktop
1. Go to [neo4j.com/download](https://neo4j.com/download/) and download **Neo4j Desktop** for Windows.
2. Install the program by running the downloaded `.exe` file.
3. Open Neo4j Desktop. You do not strictly need an activation key, you can continue with a free account.

### Step 2: Create a Local Database
1. In Neo4j Desktop, under **Projects**, click **Add** -> **Local DBMS**.
2. Name it `GraphProject` (or whatever you like).
3. **IMPORTANT**: Set the password to `password123`. 
   *(Note: If you choose a different password, you MUST update the `.env` file in this project's `server/` directory).*
4. Click **Start** to run the database.

### Step 3: Fetch the Real Internet Dataset
Open a terminal in the `knowledge_graph` directory and run:
```bash
npm install
npm run fetch-data
```
This runs the Node.js script `setup/fetch_dataset.js` which hits the OpenAlex API, pulls NLP papers, and generates CSV files inside `setup/import_data/`.

### Step 4: Move CSVs to Neo4j Import Folder
Neo4j restricts where it can read local files from for security. You must move the generated CSVs into the active database's `import` folder.
1. In Neo4j Desktop, click the **three dots [...]** next to your running `GraphProject` DBMS.
2. Click **Open Folder** -> **Import**.
3. A Windows Explorer window will open. Copy all the `.csv` files from `D:\Sanjay\B.Tech CSE\knowledge_graph\setup\import_data\` into this folder.

### Step 5: Import Data to Neo4j
1. In Neo4j Desktop, click the big blue **Open** button next to your DBMS to open **Neo4j Browser**.
2. Open `setup/01_create_schema.cypher` from this project. Copy its contents, paste them into the top command line of the Neo4j Browser, and press **Run** (Play button on the right).
3. Open `setup/02_import.cypher`. **Run each LOAD CSV block one at a time** in the Neo4j Browser.

### Step 6: Start the Dashboard
1. Open a terminal in `knowledge_graph` and run:
```bash
npm start
```
2. Open your web browser and go to: `http://localhost:3000`
3. Click the Reasoning Query buttons on the left to see reasoning in action!

---

## 🧠 Reasoning Explanations

### 1. Indirect Relationship Inference
**Query:** "Find researchers who work in the same field but belong to different universities."
* **How it works:** Traditional relational databases would require massive complex JOIN clauses. In Neo4j, we simply specify an *Anti-Pattern* (`id(i1) <> id(i2)`) traversing through common concepts.
* **Why it's smart:** This demonstrates "graph-based recommendation". You can discover unknown potential collaborators purely by tracking traversal paths, even if the two authors have literally never interacted or cited each other.

### 2. Cross-Disciplinary Discovery
**Query:** "Authors publishing across 3 or more concepts"
* **How it works:** We traverse `(Author)->(Paper)->(Concept)` and collect distinct fields.
* **Why it's smart:** This is semantic reasoning computing an unstated property ("interdisciplinary") based purely on the structure of the surrounding graph edges over time.
