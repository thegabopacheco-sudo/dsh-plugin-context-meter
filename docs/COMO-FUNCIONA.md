# Cómo funciona dsh-plugin-context-meter

Medidor de contexto por sesion de DeepSeek Harness: lee la cache de proyeccion, muestra presion de contexto, desglose de tokens (sistema/tools/mensajes), uso ultimo y sesiones recientes con recomendaciones.

## Arquitectura

```
DSH ──MCP stdio──► server.mjs (bundle single-file)
                    └─ lógica local del plugin
```

## Herramientas reales

- `status`: Estado
- `latest`: Sesión detallada
- `list`: Sesiones por presión

## Seguridad

- Lectura por defecto; acciones con `confirm:true`.
- Modo `read-only` por variable de entorno.
- Listas blancas cuando aplique.
- Auditoría en `<DSH_HOME>\cache\context-meter\audit.jsonl`.
- Rate limit de acciones.

## Verificación

Tests end-to-end con el cliente MCP oficial (`@modelcontextprotocol/client@2.2.0`)
y artefacto empaquetado (`npm pack` → `postinstall` → servidor desplegado).
