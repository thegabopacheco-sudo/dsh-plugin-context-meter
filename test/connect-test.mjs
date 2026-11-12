// Test end-to-end de context-meter con cache de proyección sintética.
import path from 'node:path';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const packageDir = path.resolve(import.meta.dirname, '..');
const tmpDir = path.join(packageDir, 'test', 'tmp');
rmSync(tmpDir, { recursive: true, force: true });
const home = path.join(tmpDir, 'dsh-home');
const proj = path.join(home, 'storages', 'session_projcache', 'sessions');
mkdirSync(proj, { recursive: true });

const wrap = (val, seq = 10) => ({ ver: 1, seq, val });
function writeSession(sessionId, rows) {
  writeFileSync(path.join(proj, `${sessionId}.json`), JSON.stringify({ version: 7, record: { identity: { createdAt: 1 }, rows } }), 'utf8');
}
writeSession('aaaa-late', {
  title: wrap('Sesión grande'),
  workingDirectory: wrap('C:\\proj'),
  contextPressure: wrap({ surfaceTokens: 900000, contextWindow: 1000000, pressureTokens: 950000, sampledSurfaceTokens: 899000 }),
  contextBreakdown: wrap({ systems: [{ seq: 8, tokens: 8000 }, { seq: 4477, tokens: 20000 }], surfaceTokens: 900000, breakdown: { systemTokens: 8000, toolsTokens: 20000, messageTokens: 872000 } }),
  tokenUsage: wrap({ totals: { uncachedInputTokens: 4500000, outputTokens: 900000, cacheReadTokens: 210000000, cacheWriteTokens: 0 }, last: { turn: 41, step: 14, buckets: { uncachedInputTokens: 410, outputTokens: 488, cacheReadTokens: 204416, cacheWriteTokens: 0 } } }),
  sessionStats: wrap({ turns: 41, steps: 524, llmMs: 5412677, toolMs: 4991554, decodeTokens: 925852, lastTurn: 41 }),
  sessionListMetadata: wrap({ blank: false, lastPromptAt: 1794454320800 }),
});
writeSession('bbbb-early', {
  title: wrap('Sesión chica'),
  contextPressure: wrap({ surfaceTokens: 100000, contextWindow: 1000000, pressureTokens: 120000 }),
  contextBreakdown: wrap({ systems: [], surfaceTokens: 100000, breakdown: { systemTokens: 5000, toolsTokens: 10000, messageTokens: 85000 } }),
  sessionStats: wrap({ turns: 3, steps: 12, llmMs: 1000, toolMs: 500 }),
  sessionListMetadata: wrap({ blank: false, lastPromptAt: 1794454220800 }),
});
writeSession('cccc-empty', { title: wrap('Sin métricas'), sessionListMetadata: wrap({ blank: false, lastPromptAt: 1794454120800 }) });
writeFileSync(path.join(proj, 'roto.json'), '{ no es JSON', 'utf8');

function makeClient() {
  const entry = process.env.CONTEXT_SERVER ? path.resolve(process.env.CONTEXT_SERVER) : path.join(packageDir, 'server.mjs');
  const transport = new StdioClientTransport({ command: process.execPath, args: [entry], env: { SystemRoot: process.env.SystemRoot || 'C:\\Windows', PATH: process.env.PATH, USERPROFILE: process.env.USERPROFILE, HOME: process.env.HOME || process.env.USERPROFILE, TEMP: process.env.TEMP, TMP: process.env.TMP, DSH_HOME: home }, stderr: 'pipe' });
  transport.stderr?.on('data', (c) => process.stderr.write(`[server] ${c}`));
  const client = new Client({ name: 'context-test', version: '1.0.0' }, { capabilities: {}, versionNegotiation: { mode: 'auto' } });
  return client.connect(transport).then(() => ({ client, transport }));
}
const textOf = (r) => (r.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');

const { client, transport } = await makeClient();
console.log('tools:', (await client.listTools()).tools.map((t) => t.name).join(', '));
console.log('--- status ---'); console.log(textOf(await client.callTool({ name: 'status', arguments: {} })));
const statusText = textOf(await client.callTool({ name: 'status', arguments: {} }));
console.log('última detectada:', statusText.includes('Sesión grande'));
console.log('presión 90%:', statusText.includes('90.0%') && statusText.includes('crítico'));
console.log('mensajes ~96.9%:', statusText.includes('96.9%'));
console.log('recomendación llena:', statusText.includes('casi lleno'));
const latest = await client.callTool({ name: 'latest', arguments: {} });
const latestText = textOf(latest);
console.log('--- latest ---'); console.log(latestText);
console.log('último paso:', latestText.includes('turno 41, paso 14'));
console.log('actividad:', latestText.includes('41 turnos') && latestText.includes('524 pasos'));
const list = await client.callTool({ name: 'list', arguments: { limit: 10 } });
const listText = textOf(list);
console.log('--- list ---'); console.log(listText);
console.log('lista 2 sesiones con datos:', listText.includes('Sesión grande') && listText.includes('Sesión chica'));
console.log('sin métricas no rompe:', listText.includes('Sin métricas'));
const byId = await client.callTool({ name: 'latest', arguments: { sessionId: 'bbbb' } });
console.log('por id chica:', textOf(byId).includes('Sesión chica'));
const missing = await client.callTool({ name: 'latest', arguments: { sessionId: 'no-existe' } });
console.log('inexistente isError:', missing.isError === true);
await client.close(); try { await transport.close?.(); } catch {}
console.log('OK');
