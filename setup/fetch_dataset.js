const fs = require('fs');
const path = require('path');

// output dir for generated CSVs
const outDir = path.join(__dirname, 'import_data');
if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
}

// pulling NLP-related works from OpenAlex (free, no key needed)
// C204321447 = Natural Language Processing concept ID
const API_URL =
    'https://api.openalex.org/works' +
    '?filter=concepts.id:C204321447' +
    '&per-page=150' +
    '&sort=cited_by_count:desc';

// safely extract the trailing ID from an OpenAlex URI like
// "https://openalex.org/W12345" -> "W12345"
// returns null if the input is null/undefined
function extractId(uri) {
    if (!uri) return null;
    return uri.split('/').pop();
}

function sanitize(str) {
    if (!str) return '';
    return str.replace(/"/g, '""').replace(/,/g, '');
}

async function fetchAndGenerate() {
    console.log('Hitting OpenAlex API for NLP papers...');

    const response = await fetch(API_URL);
    if (!response.ok) {
        throw new Error(`OpenAlex responded with HTTP ${response.status}`);
    }

    const data = await response.json();
    const works = data.results;
    console.log(`Got ${works.length} papers from the API.`);

    // node maps  (id -> csv row string)
    const papers       = new Map();
    const authors      = new Map();
    const institutions = new Map();
    const concepts     = new Map();

    // edge arrays
    const writes        = [];
    const belongsTo     = [];
    const affiliatedWith = [];
    const cites         = [];

    // keep a set of full URIs so we can match CITES within our sample
    const validWorkUris = new Set(works.map(w => w.id));

    for (const work of works) {
        if (!work.id) continue;   // skip if the work itself has no id (rare but possible)

        const paperId   = extractId(work.id);
        const title     = sanitize(work.title) || 'Untitled';
        const year      = work.publication_year || 0;
        const citations = work.cited_by_count   || 0;

        papers.set(paperId, `${paperId},"${title}",${year},${citations}`);

        // --- authorships ---
        for (const auth of work.authorships ?? []) {
            const authorUri = auth?.author?.id;
            if (!authorUri) continue;            // skip anonymous / deduped entries

            const authorId   = extractId(authorUri);
            const authorName = sanitize(auth.author.display_name) || 'Unknown';

            authors.set(authorId, `${authorId},"${authorName}"`);
            writes.push(`${authorId},${paperId}`);

            // institutions the author listed on this paper
            for (const inst of auth.institutions ?? []) {
                if (!inst?.id) continue;         // some institutions have null id too

                const instId   = extractId(inst.id);
                const instName = sanitize(inst.display_name) || 'Unknown';
                const country  = inst.country_code || 'Unknown';

                institutions.set(instId, `${instId},"${instName}","${country}"`);
                affiliatedWith.push(`${authorId},${instId}`);
            }
        }

        // --- concepts / fields (top 3 only to keep graph manageable) ---
        const topConcepts = (work.concepts ?? []).slice(0, 3);
        for (const c of topConcepts) {
            if (!c?.id) continue;

            const conceptId   = extractId(c.id);
            const conceptName = sanitize(c.display_name);

            concepts.set(conceptId, `${conceptId},"${conceptName}"`);
            belongsTo.push(`${paperId},${conceptId}`);
        }
    }

    // --- CITES (only links that stay inside our 150-paper sample) ---
    for (const work of works) {
        if (!work.id) continue;
        const paperId = extractId(work.id);

        for (const refUri of work.referenced_works ?? []) {
            if (validWorkUris.has(refUri)) {
                cites.push(`${paperId},${extractId(refUri)}`);
            }
        }
    }

    // --- write CSVs ---
    const dedupe   = arr => [...new Set(arr)];
    const writeCSV = (filename, header, src) => {
        const rows    = src instanceof Map ? [...src.values()] : src;
        const content = [header, ...rows].join('\n');
        fs.writeFileSync(path.join(outDir, filename), content, 'utf8');
        console.log(`  wrote ${filename}  (${rows.length} rows)`);
    };

    console.log('\nWriting node CSVs...');
    writeCSV('papers.csv',       'id,title,year,citations',    papers);
    writeCSV('authors.csv',      'id,name',                    authors);
    writeCSV('institutions.csv', 'id,name,country',            institutions);
    writeCSV('concepts.csv',     'id,name',                    concepts);

    console.log('Writing relationship CSVs...');
    writeCSV('writes.csv',         'authorId,paperId',       dedupe(writes));
    writeCSV('belongs_to.csv',     'paperId,conceptId',      dedupe(belongsTo));
    writeCSV('affiliated_with.csv','authorId,instId',        dedupe(affiliatedWith));
    writeCSV('cites.csv',          'paperId,citedPaperId',   dedupe(cites));

    console.log('\nDone. Copy everything in setup/import_data/ into Neo4j\'s import folder.');
}

fetchAndGenerate().catch(err => {
    console.error('Something went wrong:', err.message);
    process.exit(1);
});
