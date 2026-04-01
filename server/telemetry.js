const { Langfuse } = require('langfuse');
const http = require('http');

// Initialize Langfuse client
// If keys are not provided, it initializes but won't send payloads (fail-safe)
const langfuse = new Langfuse({
  secretKey: process.env.LANGFUSE_SECRET_KEY || 'sk-none',
  publicKey: process.env.LANGFUSE_PUBLIC_KEY || 'pk-none',
  baseUrl: process.env.LANGFUSE_HOST || 'https://cloud.langfuse.com'
});

// Configure alert thresholds
const THRESHOLDS = {
    SLOW_QUERY_MS: 1500,
    EMPTY_VISUALIZER_NODES: 2,
    SLOW_LLM_MS: 10000 
};

// Structured Logger
const logger = {
    log: (level, type, message, meta = {}) => {
        const payload = { timestamp: new Date().toISOString(), level, type, message, ...meta };
        if (level === 'ERROR' || level === 'ALERT') {
            console.error(JSON.stringify(payload));
        } else {
            console.log(JSON.stringify(payload));
        }
    },
    info: (type, message, meta) => logger.log('INFO', type, message, meta),
    error: (type, message, meta) => logger.log('ERROR', type, message, meta),
    alert: (type, message, meta) => logger.log('ALERT', type, message, meta)
};

// Wrapper for Neo4j Session
async function wrapNeo4jSession(session, cypher, trace, spanName = "Neo4j Query", metaOverride = {}) {
    const span = trace ? trace.span({ name: spanName, input: { cypher } }) : null;
    const start = Date.now();
    let records = [];
    let error = null;

    try {
        const result = await session.run(cypher);
        records = result.records.map(r => {
            const obj = {};
            r.keys.forEach(k => {
                const val = r.get(k);
                // Handle Neo4j Ints generically
                obj[k] = val && val.toNumber ? val.toNumber() : val;
            });
            return obj;
        });
    } catch (e) {
        error = e;
    } finally {
        const latency = Date.now() - start;
        
        if (span) {
            span.end({
                output: records.slice(0, 5), // Log up to first 5 returned rows
                level: error ? "ERROR" : "DEFAULT",
                statusMessage: error ? error.message : "Success",
                metadata: {
                    latency_ms: latency,
                    returned_records: records.length,
                    ...metaOverride
                }
            });
        }

        // Logging & Alerts
        if (error) {
            logger.error('DB_QUERY_ERROR', 'Neo4j query failed', { error: error.message, cypher });
            throw error;
        } else {
            logger.info('DB_QUERY_SUCCESS', 'Neo4j query executed', { latency_ms: latency, records: records.length, spanName });
            if (latency > THRESHOLDS.SLOW_QUERY_MS) {
                logger.alert('SLOW_QUERY', `Query exceeded ${THRESHOLDS.SLOW_QUERY_MS}ms`, { latency_ms: latency, cypher });
            }
        }
        return records;
    }
}

// Wrapper for Ollama Llama generation
async function wrapOllamaCall(prompt, model, trace, spanName = "LLM Generation", metadata = {}) {
    // If Langfuse trace provided, create a generation logging block
    const generation = trace ? trace.generation({
        name: spanName,
        model: model,
        prompt: prompt,
        metadata: metadata
    }) : null;

    const start = Date.now();
    let responseText = "";
    let error = null;

    try {
        logger.info('LLM_CALL_START', `Starting LLM generation for ${spanName}`, { model });

        const data = await new Promise((resolve, reject) => {
            const postData = JSON.stringify({
                model: model,
                prompt: prompt,
                stream: false
            });

            const req = http.request({
                hostname: 'localhost',
                port: 11434,
                path: '/api/generate',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(postData)
                },
                timeout: 0 // Disable 5-minute timeout Limit
            }, (res) => {
                if (res.statusCode !== 200) {
                    return reject(new Error(`Ollama responded with status: ${res.statusCode}`));
                }
                
                let body = '';
                res.on('data', chunk => body += chunk);
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(body));
                    } catch (e) {
                        reject(new Error("Failed to parse Ollama response: " + e.message));
                    }
                });
            });

            req.on('error', reject);
            req.write(postData);
            req.end();
        });
        
        responseText = data.response;
        
        // Approximate token extraction if Ollama provides it (eval_count)
        const eval_count = data.eval_count || Math.ceil(responseText.length / 4);
        const prompt_eval_count = data.prompt_eval_count || Math.ceil(prompt.length / 4);

        if (generation) {
            generation.end({
                completion: responseText,
                usage: {
                    promptTokens: prompt_eval_count,
                    completionTokens: eval_count,
                    totalTokens: prompt_eval_count + eval_count,
                }
            });
        }

    } catch (e) {
        error = e;
        if (generation) {
            generation.end({
                level: "ERROR",
                statusMessage: e.message
            });
        }
    } finally {
        const latency = Date.now() - start;
        if (error) {
            logger.error('LLM_CALL_ERROR', `LLM call failed for ${spanName}`, { error: error.message, latency_ms: latency });
            throw error;
        } else {
            logger.info('LLM_CALL_SUCCESS', `LLM call completed for ${spanName}`, { latency_ms: latency, promptTokens: Math.ceil(prompt.length / 4), completionTokens: Math.ceil(responseText.length / 4) });
            if (latency > THRESHOLDS.SLOW_LLM_MS) {
                logger.alert('SLOW_LLM_RESPONSE', `LLM generation took very long: ${latency}ms`, { latency_ms: latency });
            }
        }
    }
    return responseText;
}

module.exports = {
    langfuse,
    logger,
    wrapNeo4jSession,
    wrapOllamaCall,
    THRESHOLDS
};
