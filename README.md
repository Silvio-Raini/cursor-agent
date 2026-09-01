# Cursor Agent

Standalone web UI for local [Cursor Agents](https://cursor.com/docs/sdk) via `@cursor/sdk`.

Self-hosted: run agents on your machine with your API key, session history, and SSE streaming.

## Quick start

```bash
cp .env.example .env
# Edit SESSION_SECRET, BOOTSTRAP_PASSWORD, CURSOR_API_KEY, WORKSPACES

npm install
npm run build
npm start
```

Open `http://127.0.0.1:3450`, log in, optionally set API key under **Settings**.

## Environment

| Variable | Description |
|----------|-------------|
| `SESSION_SECRET` | Cookie signing (min 32 chars) |
| `BOOTSTRAP_USERNAME` / `BOOTSTRAP_PASSWORD` | Initial admin |
| `CURSOR_API_KEY` | Cursor API key (or set in UI) |
| `WORKSPACES` | Optional allowlist of allowed project roots (comma-separated, not exposed in UI) |
| `AGENT_ALLOW_ANY_PATH` | `true` to allow any existing absolute path when `WORKSPACES` is empty |

## Production

- Reverse proxy with HTTPS (nginx/Caddy)
- systemd unit pointing to `npm start` or `node dist/server/index.js`
- Change bootstrap password after first login

## License

MIT — CodigoWorks
