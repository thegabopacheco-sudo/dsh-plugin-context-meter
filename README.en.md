# dsh-plugin-context-meter — Context Meter

Medidor de contexto por sesion de DeepSeek Harness: lee la cache de proyeccion, muestra presion de contexto, desglose de tokens (sistema/tools/mensajes), uso ultimo y sesiones recientes con recomendaciones.

## Tools

| Tool | Qué hace |
|---|---|
| `status` | Estado |
| `latest` | Sesión detallada |
| `list` | Sesiones por presión |

## Instalación

Desde **DSH → Settings → Plugins** instala `github:thegabopacheco-sudo/dsh-plugin-context-meter` y permite el script de instalación.

```
dsh plugin --profile <perfil> add github:thegabopacheco-sudo/dsh-plugin-context-meter
```

## Seguridad

- Lectura por defecto; escritura solo con `confirm:true` y pedido explícito.
- `DSH_CONTEXT_METER_MODE=read-only` desactiva acciones.
- Listas blancas y auditoría en `<DSH_HOME>\cache\context-meter\audit.jsonl`.

## Licencia

MIT © thegabopacheco-sudo
