# Migrating MCP Servers to Dual Transport + Native Node TypeScript

This documents the refactoring pattern used in this repo to:

1. Support both **stdio** and **HTTP** transports from a single codebase
2. Replace **tsx** and **tsc build steps** with Node's native TypeScript support

Use this as a reference when applying the same changes to other MCP server projects.

## Why

- **Stdio** is the standard transport for MCP clients (Claude Desktop, Claude Code, etc.)
- **HTTP** (Streamable HTTP) is needed for remote/networked usage and REST APIs
- Running both from one codebase avoids duplication
- Node 23+ strips TypeScript natively — no build step, no tsx, no source maps to debug

## File Structure

```
src/
  index.ts   # Entry point: server setup + tool registration, delegates to transport
  stdio.ts   # Stdio transport (tiny, no express deps loaded)
  http.ts    # HTTP transport + REST API + Swagger
```

### src/stdio.ts

Minimal — just connects the MCP server to a `StdioServerTransport`:

```ts
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export async function startStdio(server: McpServer) {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
```

### src/http.ts

Contains all express/HTTP logic: `StreamableHTTPServerTransport` session management, REST API routes, Swagger UI, etc. Exports a single `startHttp()` function.

### src/index.ts

Keeps all shared logic (MCP server creation, tool registrations, helpers). At the bottom, delegates based on `--stdio` flag:

```ts
async function main() {
  if (process.argv.includes('--stdio')) {
    const { startStdio } = await import('./stdio.ts');
    await startStdio(server);
  } else {
    const { startHttp } = await import('./http.ts');
    await startHttp(server, hueClient, isConfigured, PORT);
  }
}

main().catch(console.error);
```

Dynamic imports are intentional — stdio mode never loads express, swagger-ui-dist, or any HTTP dependencies.

## Removing tsx and the Build Step

### package.json

Before:
```json
{
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "node src/index.ts",
    "dev": "tsx watch src/index.ts"
  },
  "devDependencies": {
    "tsx": "^4.21.0"
  }
}
```

After:
```json
{
  "scripts": {
    "start": "node src/index.ts",
    "start:stdio": "node src/index.ts --stdio"
  }
}
```

- Remove `main` (no dist to point to)
- Remove `build` and `dev` scripts
- Remove `tsx` from devDependencies
- Run `npm install` to clean the lockfile

### tsconfig.json

Before:
```json
{
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "sourceMap": true,
    "declaration": true,
    ...
  }
}
```

After:
```json
{
  "compilerOptions": {
    "noEmit": true,
    ...
  }
}
```

- Remove `rootDir`, `outDir`, `sourceMap`, `declaration` (all build-related)
- Add `noEmit: true` — tsconfig is now for editor/CI type-checking only
- Keep `allowImportingTsExtensions: true` if your imports use `.ts` extensions

### .mcp.json

Before:
```json
{
  "mcpServers": {
    "my-server": {
      "command": "tsx",
      "args": ["src/index.ts", "--stdio"]
    }
  }
}
```

After:
```json
{
  "mcpServers": {
    "my-server": {
      "command": "node",
      "args": ["src/index.ts", "--stdio"]
    }
  }
}
```

### Dockerfile

Before (multi-stage with build):
```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY src ./src
COPY tsconfig.json ./
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
CMD ["node", "dist/index.js"]
```

After (single stage, no build):
```dockerfile
FROM node:25-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY tsconfig.json ./
CMD ["node", "src/index.ts"]
```

- Use `node:25-alpine` (or 23+) for stable TypeScript stripping
- Single stage — no builder, no dist
- `tsconfig.json` is still copied because Node reads it for module resolution settings

## Node Version Requirements

| Node Version | TypeScript Support |
|---|---|
| < 22.6 | Not available — use tsx or build with tsc |
| 22.6 - 22.x | `--experimental-strip-types` flag required |
| 23.0 - 23.5 | `--experimental-strip-types` flag required |
| 23.6+ | Stable, no flag needed |
| 25+ | Stable, no flag needed |

If you must use Node 22, add the flag in your scripts:
```json
"start": "node --experimental-strip-types src/index.ts"
```

## Limitations of Node's Type Stripping

Node strips types but does **not** transform TypeScript-only syntax:

- **Enums**: Not supported. Use `as const` objects instead.
- **Namespaces**: Not supported. Use ES modules.
- **Parameter properties** (`constructor(private x: number)`): Not supported. Assign in constructor body.
- **`experimentalDecorators`**: Not supported without `--experimental-transform-types`.

Standard type annotations, interfaces, `type` imports, generics, and `as` casts all work fine.

## Checklist

When applying this to another MCP project:

- [ ] Create `src/stdio.ts` with `startStdio(server)` function
- [ ] Create `src/http.ts` with `startHttp(server, ...)` function (move all express/transport code here)
- [ ] Refactor `src/index.ts` to keep server setup, use dynamic imports for transport
- [ ] Update `package.json`: remove `main`, `build`, `dev`, tsx dep
- [ ] Update `tsconfig.json`: remove `outDir`/`rootDir`/`sourceMap`/`declaration`, add `noEmit`
- [ ] Update `.mcp.json`: change `tsx` to `node`
- [ ] Update `Dockerfile`: single stage, `node:25-alpine`, run source directly
- [ ] Run `npm install` to clean lockfile
- [ ] Run `npx tsc --noEmit` to verify types still check
- [ ] Test stdio tools via MCP client
- [ ] Delete `dist/` directory if it exists
