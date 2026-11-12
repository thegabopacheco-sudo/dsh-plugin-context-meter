# How dsh-plugin-context-meter works

Medidor de contexto por sesion de DeepSeek Harness: lee la cache de proyeccion, muestra presion de contexto, desglose de tokens (sistema/tools/mensajes), uso ultimo y sesiones recientes con recomendaciones.

## Architecture

```
DSH ──MCP stdio──► server.mjs (single-file bundle)
                    └─ local plugin logic
```

## Safety

- Read by default; actions require `confirm:true`.
- `read-only` mode via environment variable.
- Allowlists where applicable.
- Audit at `<DSH_HOME>\cache\context-meter\audit.jsonl`.
- Action rate limit.

## Validation

End-to-end tests with the official MCP client (`@modelcontextprotocol/client@2.2.0`)
and the packaged artifact (`npm pack` → `postinstall` → deployed server).
