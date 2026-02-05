import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { createOpenApiRouter, getOpenApiSpec, getSwaggerHtml } from './openapi.ts';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { createRequire } from 'node:module';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { HueClient } from './hue-client.ts';

const require = createRequire(import.meta.url);
const swaggerUiPath = require('swagger-ui-dist/absolute-path.js');

export async function startHttp(server: McpServer, hueClient: HueClient, isConfigured: () => boolean, port: number) {
  const transports: Record<string, StreamableHTTPServerTransport> = {};
  const app = createMcpExpressApp({ host: '0.0.0.0' });

  app.post('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    try {
      if (sessionId && transports[sessionId]) {
        await transports[sessionId].handleRequest(req, res, req.body);
      } else if (!sessionId && isInitializeRequest(req.body)) {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => { transports[sid] = transport; },
        });
        transport.onclose = () => { if (transport.sessionId) delete transports[transport.sessionId]; };
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
      } else {
        res.status(400).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Bad Request: No valid session ID' }, id: null });
      }
    } catch {
      if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
    }
  });

  app.get('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId || !transports[sessionId]) return res.status(400).send('Invalid or missing session ID');
    await transports[sessionId].handleRequest(req, res);
  });

  app.delete('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId || !transports[sessionId]) return res.status(400).send('Invalid or missing session ID');
    await transports[sessionId].handleRequest(req, res);
  });

  // REST API routes
  app.use('/api', createOpenApiRouter(hueClient, isConfigured));
  app.get('/openapi.json', (_req, res) => { res.json(getOpenApiSpec(port)); });
  app.use('/swagger', express.static(swaggerUiPath()));
  app.get('/docs', (_req, res) => { res.type('html').send(getSwaggerHtml()); });

  app.listen(port, () => {
    console.log(`Philips Hue MCP server running on http://0.0.0.0:${port}/mcp`);
    console.log(`REST API docs available at http://0.0.0.0:${port}/docs`);
  });
}
