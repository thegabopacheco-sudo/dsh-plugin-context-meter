#!/usr/bin/env node
// dsh-plugin-context-meter — mide presión y composición del contexto por sesión.
// Tools: status, latest, list.

import path from 'node:path';
import os from 'node:os';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';

const VERSION = '0.1.0';
const DSH_HOME = (() => {
  const v = process.env.DSH_HOME && process.env.DSH_HOME.trim();
  return v || path.join(process.env.USERPROFILE || process.env.HOME || os.homedir(), '.dsh');
})();
const PROJ_ROOT = path.join(DSH_HOME, 'storages', 'session_projcache', 'sessions');
const log = (m) => process.stderr.write(`[context] ${m}\n`);

function unwrap(value) {
  if (value && typeof value === 'object' && 'val' in value) return value.val;
  return value;
}
function num(value) { return typeof value === 'number' && Number.isFinite(value) ? value : 0; }
function pct(part, total) { return total > 0 ? (part / total) * 100 : 0; }
function fmtTokens(tokens) {
  if (tokens >= 1e6) return `${(tokens / 1e6).toFixed(2)}M`;
  if (tokens >= 1e3) return `${(tokens / 1e3).toFixed(1)}k`;
  return String(tokens);
}

function sessionFiles() {
  try { return readdirSync(PROJ_ROOT, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith('.json')).map((entry) => path.join(PROJ_ROOT, entry.name)); } catch { return []; }
}

function readSession(file) {
  try {
    const data = JSON.parse(readFileSync(file, 'utf8')) || {};
    const rows = data.record?.rows || {};
    const pressure = unwrap(rows.contextPressure) || {};
    const breakdownData = unwrap(rows.contextBreakdown) || {};
    const usage = unwrap(rows.tokenUsage) || {};
    const stats = unwrap(rows.sessionStats) || {};
    const meta = unwrap(rows.sessionListMetadata) || {};
    const titleValue = unwrap(rows.title);
    const cwdValue = unwrap(rows.workingDirectory);
    return {
      file,
      sessionId: path.basename(file, '.json'),
      title: typeof titleValue === 'string' ? titleValue : null,
      cwd: typeof cwdValue === 'string' ? cwdValue : null,
      mtime: statSync(file).mtimeMs,
      lastPromptAt: num(meta.lastPromptAt),
      pressure: { surfaceTokens: num(pressure.surfaceTokens), contextWindow: num(pressure.contextWindow), pressureTokens: num(pressure.pressureTokens), sampledSurfaceTokens: num(pressure.sampledSurfaceTokens) },
      breakdown: { systemTokens: num(breakdownData.breakdown?.systemTokens), toolsTokens: num(breakdownData.breakdown?.toolsTokens), messageTokens: num(breakdownData.breakdown?.messageTokens), surfaceTokens: num(breakdownData.surfaceTokens), systems: Array.isArray(breakdownData.systems) ? breakdownData.systems : [] },
      usage: {
        totals: { uncachedInputTokens: num(usage.totals?.uncachedInputTokens), outputTokens: num(usage.totals?.outputTokens), cacheReadTokens: num(usage.totals?.cacheReadTokens), cacheWriteTokens: num(usage.totals?.cacheWriteTokens) },
        last: usage.last || null,
      },
      stats: { turns: num(stats.turns), steps: num(stats.steps), llmMs: num(stats.llmMs), toolMs: num(stats.toolMs), decodeTokens: num(stats.decodeTokens), lastTurn: num(stats.lastTurn) },
    };
  } catch { return null; }
}

function allSessions(limit = 200) {
  return sessionFiles()
    .map(readSession)
    .filter(Boolean)
    .sort((a, b) => (b.lastPromptAt || b.mtime) - (a.lastPromptAt || a.mtime))
    .slice(0, limit);
}

function pressureLevel(percent) {
  if (percent >= 90) return '🔴 crítico';
  if (percent >= 75) return '🟠 alto';
  if (percent >= 50) return '🟡 medio';
  return '🟢 bajo';
}
function pressureLine(session) {
  const percent = pct(session.pressure.surfaceTokens, session.pressure.contextWindow);
  return `${percent.toFixed(1)}% ${pressureLevel(percent)} · ${fmtTokens(session.pressure.surfaceTokens)} / ${fmtTokens(session.pressure.contextWindow)} tokens`;
}
function breakdownLines(session) {
  const total = session.breakdown.surfaceTokens || session.pressure.surfaceTokens || 1;
  const parts = [['sistema', session.breakdown.systemTokens], ['tools', session.breakdown.toolsTokens], ['mensajes', session.breakdown.messageTokens]];
  return parts.map(([label, value]) => `- ${label}: ${fmtTokens(value)} (${pct(value, total).toFixed(1)}%)`);
}
function recommendation(session) {
  const percent = pct(session.pressure.surfaceTokens, session.pressure.contextWindow);
  const total = session.breakdown.surfaceTokens || 1;
  if (percent >= 90) return 'Contexto casi lleno: compactá o iniciá una sesión nueva antes de seguir.';
  if (pct(session.breakdown.messageTokens, total) >= 80) return 'La mayor parte es historial de mensajes: resumí/compactá para liberar espacio.';
  if (pct(session.breakdown.toolsTokens, total) >= 40) return 'Muchas tools cargadas: desinstalá plugins que no uses para bajar el contexto.';
  if (percent >= 75) return 'Presión alta: conviene resumir pronto.';
  return 'Presión sana.';
}
function textResult(text) { return { content: [{ type: 'text', text }] }; }

function buildInstructions() {
  return [
    'Context Meter: mide la presión de contexto de las sesiones del harness.',
    '',
    `Cache: ${PROJ_ROOT}`,
    '',
    'Herramientas: status, latest, list.',
    '',
    'Reglas:',
    '- Solo lectura: no escribe ni modifica sesiones.',
    '- Los datos vienen de la cache de proyección local (contextPressure/tokenUsage/contextBreakdown).',
    '- Reporta cifras reales; si faltan datos para una sesión, lo indica.',
  ].join('\n');
}

function buildServer() {
  const server = new McpServer({ name: 'dsh-plugin-context-meter', version: VERSION }, { capabilities: { tools: {} }, instructions: buildInstructions() });

  server.registerTool(
    'status',
    { title: 'Estado', description: 'Resumen de la sesión más reciente y cantidad de sesiones.', inputSchema: z.object({}) },
    async () => {
      const sessions = allSessions();
      if (sessions.length === 0) return textResult(`Sin sesiones en ${PROJ_ROOT}.`);
      const latest = sessions[0];
      return textResult([
        `Sesiones con datos: ${sessions.length}`,
        `Última: ${latest.title || '(sin título)'}`,
        `Presión: ${pressureLine(latest)}`,
        'Desglose:',
        ...breakdownLines(latest),
        `Recomendación: ${recommendation(latest)}`,
      ].join('\n'));
    },
  );

  server.registerTool(
    'latest',
    { title: 'Sesión detallada', description: 'Detalle de presión y tokens de la sesión más reciente (o una por id).', inputSchema: z.object({ sessionId: z.string().optional() }) },
    async (args) => {
      const sessions = allSessions();
      const session = args.sessionId ? sessions.find((item) => item.sessionId.startsWith(args.sessionId)) : sessions[0];
      if (!session) throw new Error(`sesión no encontrada: ${args.sessionId || '(ninguna)'}`);
      const percent = pct(session.pressure.surfaceTokens, session.pressure.contextWindow);
      const systemsTail = session.breakdown.systems.slice(-5);
      const last = session.usage.last;
      return textResult([
        `# ${session.title || '(sin título)'}`,
        `id: ${session.sessionId}${session.cwd ? ` · cwd: ${session.cwd}` : ''}`,
        '',
        `Presión: ${percent.toFixed(1)}% ${pressureLevel(percent)}`,
        `Surface: ${fmtTokens(session.pressure.surfaceTokens)} / ventana ${fmtTokens(session.pressure.contextWindow)} · presión ${fmtTokens(session.pressure.pressureTokens)}`,
        '',
        'Composición:',
        ...breakdownLines(session),
        systemsTail.length ? `Sistema (histórico): ${systemsTail.map((s) => `${fmtTokens(num(s.tokens))}@${s.seq ?? '?'}`).join(' → ')}` : '',
        '',
        `Uso total: input ${fmtTokens(session.usage.totals.uncachedInputTokens)} · output ${fmtTokens(session.usage.totals.outputTokens)} · cache read ${fmtTokens(session.usage.totals.cacheReadTokens)}`,
        last ? `Último paso (turno ${last.turn}, paso ${last.step}): input ${fmtTokens(num(last.buckets?.uncachedInputTokens))} · output ${fmtTokens(num(last.buckets?.outputTokens))} · cache ${fmtTokens(num(last.buckets?.cacheReadTokens))}` : '',
        '',
        `Actividad: ${session.stats.turns} turnos · ${session.stats.steps} pasos · LLM ${(session.stats.llmMs / 1000).toFixed(0)} s · tools ${(session.stats.toolMs / 1000).toFixed(0)} s`,
        `Recomendación: ${recommendation(session)}`,
      ].filter((line) => line !== '').join('\n'));
    },
  );

  server.registerTool(
    'list',
    { title: 'Sesiones por presión', description: 'Lista sesiones recientes con presión de contexto.', inputSchema: z.object({ limit: z.number().int().min(1).max(50).optional() }) },
    async (args) => {
      const sessions = allSessions().slice(0, args.limit ?? 15);
      if (sessions.length === 0) return textResult(`Sin sesiones en ${PROJ_ROOT}.`);
      return textResult(sessions.map((session) => {
        const percent = pct(session.pressure.surfaceTokens, session.pressure.contextWindow);
        return `${percent.toFixed(1)}% ${pressureLevel(percent)} · ${session.title || '(sin título)'} · ${fmtTokens(session.pressure.surfaceTokens)}/${fmtTokens(session.pressure.contextWindow)} · ${session.stats.turns} turnos · id ${session.sessionId.slice(0, 8)}`;
      }).join('\n'));
    },
  );

  return server;
}

try { mkdirSync(path.join(DSH_HOME, 'cache', 'context-meter'), { recursive: true }); } catch { /* ignora */ }
log(`cache: ${PROJ_ROOT}`);
serveStdio(buildServer, { onerror: (e) => log(`serveStdio: ${e.message}`) });
process.on('uncaughtException', (e) => log(`excepción: ${e.message}`));
process.on('unhandledRejection', (e) => log(`rechazo: ${e && e.message ? e.message : String(e)}`));
