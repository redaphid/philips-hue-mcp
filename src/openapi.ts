import { Router, json } from 'express';
import type { Request, Response } from 'express';
import { HueClient } from './hue-client.ts';
import { colord, extend } from 'colord';
import names from 'colord/plugins/names';
import https from 'node:https';

extend([names as unknown as Parameters<typeof extend>[0][number]]);

const gamma = (v: number): number => {
  const n = v / 255;
  return n > 0.04045 ? Math.pow((n + 0.055) / 1.055, 2.4) : n / 12.92;
};

function parseColor(color: string): { xy: [number, number]; bri: number } | null {
  const c = colord(color);
  if (!c.isValid()) return null;
  const { r, g, b } = c.toRgb();
  const bri = Math.max(1, Math.round((Math.max(r, g, b) / 255) * c.alpha() * 254));
  const R = gamma(r), G = gamma(g), B = gamma(b);
  const X = R * 0.664511 + G * 0.154324 + B * 0.162028;
  const Y = R * 0.283881 + G * 0.668433 + B * 0.047685;
  const Z = R * 0.000088 + G * 0.072310 + B * 0.986039;
  const sum = X + Y + Z;
  return {
    xy: [sum === 0 ? 0.3127 : X / sum, sum === 0 ? 0.3290 : Y / sum],
    bri,
  };
}

const httpsRequest = (url: string, options: https.RequestOptions = {}, body?: string): Promise<any> =>
  new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { req.destroy(); reject(new Error('timeout')); }, 10000);
    const req = https.request(url, { ...options, rejectUnauthorized: false }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { clearTimeout(timeout); resolve(JSON.parse(data)); });
    });
    req.on('error', (e) => { clearTimeout(timeout); reject(e); });
    if (body) req.write(body);
    req.end();
  });

const paramId = (req: Request): string => String(req.params['id']);

type Handler = (req: Request, res: Response) => Promise<void>;

const wrap = (fn: Handler): Handler => async (req, res) => {
  try { await fn(req, res); }
  catch (e: any) { res.status(500).json({ error: e.message }); }
};

export function createOpenApiRouter(hueClient: HueClient, isConfigured: () => boolean) {
  const router = Router();
  router.use(json());

  const guard = (_req: Request, res: Response): boolean => {
    if (!isConfigured()) { res.status(503).json({ error: 'Not configured. Set HUE_BRIDGE_IP and HUE_USERNAME environment variables.' }); return false; }
    return true;
  };

  // Fire-and-forget: respond immediately, bridge call runs in background
  const fire = (p: Promise<any>) => { p.catch(() => {}); };

  // ---- Lights ----

  router.get('/lights', wrap(async (req, res) => {
    if (!guard(req, res)) return;
    res.json(await hueClient.getLights());
  }));

  router.get('/lights/:id', wrap(async (req, res) => {
    if (!guard(req, res)) return;
    res.json(await hueClient.getLight(paramId(req)));
  }));

  router.post('/lights/:id/on', wrap(async (req, res) => {
    if (!guard(req, res)) return;
    fire(hueClient.turnLightOn(paramId(req)));
    res.status(202).json({ message: `Light ${paramId(req)} turning on` });
  }));

  router.post('/lights/:id/off', wrap(async (req, res) => {
    if (!guard(req, res)) return;
    fire(hueClient.turnLightOff(paramId(req)));
    res.status(202).json({ message: `Light ${paramId(req)} turning off` });
  }));

  router.put('/lights/:id/brightness', wrap(async (req, res) => {
    if (!guard(req, res)) return;
    const brightness = Number(req.body.brightness);
    if (isNaN(brightness) || brightness < 0 || brightness > 1) { res.status(400).json({ error: 'brightness must be a number between 0 and 1' }); return; }
    const bri = Math.max(1, Math.round(brightness * 254));
    fire(hueClient.setBrightness(paramId(req), bri));
    res.status(202).json({ message: `Light ${paramId(req)} brightness set to ${brightness}` });
  }));

  router.put('/lights/:id/color', wrap(async (req, res) => {
    if (!guard(req, res)) return;
    const native = parseColor(req.body.color);
    if (!native) { res.status(400).json({ error: `Invalid color: "${req.body.color}"` }); return; }
    fire(hueClient.setLightState(paramId(req), { on: true, ...native }));
    res.status(202).json({ message: `Light ${paramId(req)} set to ${req.body.color}` });
  }));

  router.put('/lights/:id/color-temp', wrap(async (req, res) => {
    if (!guard(req, res)) return;
    const ct = Number(req.body.colorTemp);
    if (isNaN(ct) || ct < 153 || ct > 500) { res.status(400).json({ error: 'colorTemp must be between 153 and 500' }); return; }
    fire(hueClient.setColorTemp(paramId(req), ct));
    res.status(202).json({ message: `Light ${paramId(req)} color temperature set to ${ct} mireds` });
  }));

  router.put('/lights/:id/state', wrap(async (req, res) => {
    if (!guard(req, res)) return;
    const { on, color, colorTemp, transitionTime } = req.body;
    const colorState = color ? parseColor(color) : {};
    if (color && !parseColor(color)) { res.status(400).json({ error: `Invalid color: "${color}"` }); return; }
    fire(hueClient.setLightState(paramId(req), { on, ...colorState, ct: colorTemp, transitiontime: transitionTime }));
    res.status(202).json({ message: `Light ${paramId(req)} state updated` });
  }));

  // ---- Rooms ----

  router.get('/rooms', wrap(async (req, res) => {
    if (!guard(req, res)) return;
    res.json(await hueClient.getRooms());
  }));

  router.get('/groups', wrap(async (req, res) => {
    if (!guard(req, res)) return;
    res.json(await hueClient.getAllGroups());
  }));

  router.get('/rooms/:id', wrap(async (req, res) => {
    if (!guard(req, res)) return;
    res.json(await hueClient.getRoom(paramId(req)));
  }));

  router.post('/rooms/:id/on', wrap(async (req, res) => {
    if (!guard(req, res)) return;
    fire(hueClient.turnRoomOn(paramId(req)));
    res.status(202).json({ message: `Room ${paramId(req)} turning on` });
  }));

  router.post('/rooms/:id/off', wrap(async (req, res) => {
    if (!guard(req, res)) return;
    fire(hueClient.turnRoomOff(paramId(req)));
    res.status(202).json({ message: `Room ${paramId(req)} turning off` });
  }));

  router.put('/rooms/:id/brightness', wrap(async (req, res) => {
    if (!guard(req, res)) return;
    const brightness = Number(req.body.brightness);
    if (isNaN(brightness) || brightness < 0 || brightness > 1) { res.status(400).json({ error: 'brightness must be a number between 0 and 1' }); return; }
    const bri = Math.max(1, Math.round(brightness * 254));
    fire(hueClient.setRoomBrightness(paramId(req), bri));
    res.status(202).json({ message: `Room ${paramId(req)} brightness set to ${brightness}` });
  }));

  router.put('/rooms/:id/color', wrap(async (req, res) => {
    if (!guard(req, res)) return;
    const native = parseColor(req.body.color);
    if (!native) { res.status(400).json({ error: `Invalid color: "${req.body.color}"` }); return; }
    fire(hueClient.setRoomState(paramId(req), { on: true, ...native }));
    res.status(202).json({ message: `Room ${paramId(req)} set to ${req.body.color}` });
  }));

  router.put('/rooms/:id/color-temp', wrap(async (req, res) => {
    if (!guard(req, res)) return;
    const ct = Number(req.body.colorTemp);
    if (isNaN(ct) || ct < 153 || ct > 500) { res.status(400).json({ error: 'colorTemp must be between 153 and 500' }); return; }
    fire(hueClient.setRoomColorTemp(paramId(req), ct));
    res.status(202).json({ message: `Room ${paramId(req)} color temperature set to ${ct} mireds` });
  }));

  router.put('/rooms/:id/state', wrap(async (req, res) => {
    if (!guard(req, res)) return;
    const { on, color, colorTemp, transitionTime } = req.body;
    const colorState = color ? parseColor(color) : {};
    if (color && !parseColor(color)) { res.status(400).json({ error: `Invalid color: "${color}"` }); return; }
    fire(hueClient.setRoomState(paramId(req), { on, ...colorState, ct: colorTemp, transitiontime: transitionTime }));
    res.status(202).json({ message: `Room ${paramId(req)} state updated` });
  }));

  // ---- Scenes ----

  router.get('/scenes', wrap(async (req, res) => {
    if (!guard(req, res)) return;
    res.json(await hueClient.getScenes());
  }));

  router.post('/scenes', wrap(async (req, res) => {
    if (!guard(req, res)) return;
    const { name, roomId, lightIds } = req.body;
    if (!name) { res.status(400).json({ error: 'name is required' }); return; }
    let lights: string[];
    if (lightIds && lightIds.length > 0) {
      lights = lightIds.map(String);
    } else if (roomId) {
      const room = await hueClient.getRoom(String(roomId));
      lights = room.lights;
    } else {
      const allLights = await hueClient.getLights();
      lights = allLights.map(l => l.id);
    }
    const sceneId = await hueClient.createScene(name, lights, roomId ? String(roomId) : undefined);
    res.status(201).json({ message: `Scene "${name}" created`, id: sceneId });
  }));

  router.post('/scenes/:id/activate', wrap(async (req, res) => {
    if (!guard(req, res)) return;
    const groupId = req.body.groupId ? String(req.body.groupId) : undefined;
    fire(hueClient.activateScene(paramId(req), groupId));
    res.status(202).json({ message: `Scene ${paramId(req)} activating${groupId ? ` in group ${groupId}` : ''}` });
  }));

  router.delete('/scenes/:id', wrap(async (req, res) => {
    if (!guard(req, res)) return;
    await hueClient.deleteScene(paramId(req));
    res.json({ message: `Scene ${paramId(req)} deleted` });
  }));

  // ---- Global ----

  router.post('/all/on', wrap(async (req, res) => {
    if (!guard(req, res)) return;
    fire(hueClient.setRoomState('0', { on: true }));
    res.status(202).json({ message: 'All lights turning on' });
  }));

  router.post('/all/off', wrap(async (req, res) => {
    if (!guard(req, res)) return;
    fire(hueClient.setRoomState('0', { on: false }));
    res.status(202).json({ message: 'All lights turning off' });
  }));

  router.put('/all/color', wrap(async (req, res) => {
    if (!guard(req, res)) return;
    const native = parseColor(req.body.color);
    if (!native) { res.status(400).json({ error: `Invalid color: "${req.body.color}"` }); return; }
    fire(hueClient.setRoomState('0', { on: true, ...native }));
    res.status(202).json({ message: `All lights set to ${req.body.color}` });
  }));

  // ---- Setup ----

  router.get('/bridges/discover', wrap(async (_req, res) => {
    const bridges = await httpsRequest('https://discovery.meethue.com/');
    if (!bridges || bridges.length === 0) { res.json({ bridges: [], message: 'No Hue bridges found' }); return; }
    res.json({ bridges });
  }));

  router.post('/bridges/auth', wrap(async (req, res) => {
    const { bridgeIp, appName = 'philips-hue-mcp', deviceName = 'claude-agent' } = req.body;
    if (!bridgeIp) { res.status(400).json({ error: 'bridgeIp is required' }); return; }
    const body = JSON.stringify({ devicetype: `${appName}#${deviceName}` });
    const result = await httpsRequest(`https://${bridgeIp}/api`, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, body);
    if (Array.isArray(result) && result[0]?.error) {
      const error = result[0].error;
      if (error.type === 101) { res.status(428).json({ error: 'Link button not pressed. Press the button on the Hue bridge and retry within 30 seconds.' }); return; }
      res.status(400).json({ error: error.description }); return;
    }
    if (Array.isArray(result) && result[0]?.success?.username) {
      res.json({ username: result[0].success.username, bridgeIp });
      return;
    }
    res.status(500).json({ error: 'Unexpected response', details: result });
  }));

  router.get('/connection/test', wrap(async (_req, res) => {
    if (!isConfigured()) { res.status(503).json({ error: 'Not configured', missing: { bridgeIp: !process.env.HUE_BRIDGE_IP, username: !process.env.HUE_USERNAME } }); return; }
    const lights = await hueClient.getLights();
    res.json({ status: 'ok', bridgeIp: process.env.HUE_BRIDGE_IP, lightCount: lights.length });
  }));

  return router;
}

// ---- OpenAPI 3.0 spec ----

export function getOpenApiSpec(port: number) {
  return {
    openapi: '3.0.3',
    info: {
      title: 'Philips Hue REST API',
      version: '1.0.0',
      description: 'REST API for controlling Philips Hue lights, rooms, and scenes.',
    },
    servers: [{ url: `http://localhost:${port}/api`, description: 'Local server' }],
    paths: {
      '/lights': {
        get: {
          tags: ['Lights'], operationId: 'listLights', summary: 'List all lights',
          responses: { '200': { description: 'Array of lights', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Light' } } } } } },
        },
      },
      '/lights/{id}': {
        get: {
          tags: ['Lights'], operationId: 'getLight', summary: 'Get a specific light',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Light details', content: { 'application/json': { schema: { $ref: '#/components/schemas/Light' } } } } },
        },
      },
      '/lights/{id}/on': {
        post: {
          tags: ['Lights'], operationId: 'turnLightOn', summary: 'Turn on a light',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Success', content: { 'application/json': { schema: { $ref: '#/components/schemas/Message' } } } } },
        },
      },
      '/lights/{id}/off': {
        post: {
          tags: ['Lights'], operationId: 'turnLightOff', summary: 'Turn off a light',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Success', content: { 'application/json': { schema: { $ref: '#/components/schemas/Message' } } } } },
        },
      },
      '/lights/{id}/brightness': {
        put: {
          tags: ['Lights'], operationId: 'setLightBrightness', summary: 'Set light brightness',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['brightness'], properties: { brightness: { type: 'number', minimum: 0, maximum: 1, description: '0 = min, 1 = max' } } } } } },
          responses: { '200': { description: 'Success', content: { 'application/json': { schema: { $ref: '#/components/schemas/Message' } } } } },
        },
      },
      '/lights/{id}/color': {
        put: {
          tags: ['Lights'], operationId: 'setLightColor', summary: 'Set light color (CSS format)',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['color'], properties: { color: { type: 'string', description: 'Any CSS color. Alpha controls brightness.', example: 'rgba(255,0,0,0.5)' } } } } } },
          responses: { '200': { description: 'Success', content: { 'application/json': { schema: { $ref: '#/components/schemas/Message' } } } } },
        },
      },
      '/lights/{id}/color-temp': {
        put: {
          tags: ['Lights'], operationId: 'setLightColorTemp', summary: 'Set light color temperature',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['colorTemp'], properties: { colorTemp: { type: 'number', minimum: 153, maximum: 500, description: '153=cool daylight, 500=warm candlelight' } } } } } },
          responses: { '200': { description: 'Success', content: { 'application/json': { schema: { $ref: '#/components/schemas/Message' } } } } },
        },
      },
      '/lights/{id}/state': {
        put: {
          tags: ['Lights'], operationId: 'setLightState', summary: 'Set multiple light properties at once',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/LightStateInput' } } } },
          responses: { '200': { description: 'Success', content: { 'application/json': { schema: { $ref: '#/components/schemas/Message' } } } } },
        },
      },
      '/rooms': {
        get: {
          tags: ['Rooms'], operationId: 'listRooms', summary: 'List all rooms and zones',
          responses: { '200': { description: 'Array of rooms', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Room' } } } } } },
        },
      },
      '/groups': {
        get: {
          tags: ['Rooms'], operationId: 'listGroups', summary: 'List all groups (rooms, zones, entertainment areas)',
          responses: { '200': { description: 'Array of groups', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Room' } } } } } },
        },
      },
      '/rooms/{id}': {
        get: {
          tags: ['Rooms'], operationId: 'getRoom', summary: 'Get a specific room',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Room details', content: { 'application/json': { schema: { $ref: '#/components/schemas/Room' } } } } },
        },
      },
      '/rooms/{id}/on': {
        post: {
          tags: ['Rooms'], operationId: 'turnRoomOn', summary: 'Turn on all lights in a room',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Success', content: { 'application/json': { schema: { $ref: '#/components/schemas/Message' } } } } },
        },
      },
      '/rooms/{id}/off': {
        post: {
          tags: ['Rooms'], operationId: 'turnRoomOff', summary: 'Turn off all lights in a room',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Success', content: { 'application/json': { schema: { $ref: '#/components/schemas/Message' } } } } },
        },
      },
      '/rooms/{id}/brightness': {
        put: {
          tags: ['Rooms'], operationId: 'setRoomBrightness', summary: 'Set room brightness',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['brightness'], properties: { brightness: { type: 'number', minimum: 0, maximum: 1 } } } } } },
          responses: { '200': { description: 'Success', content: { 'application/json': { schema: { $ref: '#/components/schemas/Message' } } } } },
        },
      },
      '/rooms/{id}/color': {
        put: {
          tags: ['Rooms'], operationId: 'setRoomColor', summary: 'Set color for all lights in a room',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['color'], properties: { color: { type: 'string', example: 'red' } } } } } },
          responses: { '200': { description: 'Success', content: { 'application/json': { schema: { $ref: '#/components/schemas/Message' } } } } },
        },
      },
      '/rooms/{id}/color-temp': {
        put: {
          tags: ['Rooms'], operationId: 'setRoomColorTemp', summary: 'Set color temperature for a room',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['colorTemp'], properties: { colorTemp: { type: 'number', minimum: 153, maximum: 500 } } } } } },
          responses: { '200': { description: 'Success', content: { 'application/json': { schema: { $ref: '#/components/schemas/Message' } } } } },
        },
      },
      '/rooms/{id}/state': {
        put: {
          tags: ['Rooms'], operationId: 'setRoomState', summary: 'Set multiple room properties at once',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/LightStateInput' } } } },
          responses: { '200': { description: 'Success', content: { 'application/json': { schema: { $ref: '#/components/schemas/Message' } } } } },
        },
      },
      '/scenes': {
        get: {
          tags: ['Scenes'], operationId: 'listScenes', summary: 'List all scenes',
          responses: { '200': { description: 'Array of scenes', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Scene' } } } } } },
        },
        post: {
          tags: ['Scenes'], operationId: 'createScene', summary: 'Create a scene from current light states',
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, roomId: { type: 'string', description: 'Create from all lights in this room' }, lightIds: { type: 'array', items: { type: 'string' }, description: 'Create from specific lights' } } } } } },
          responses: { '201': { description: 'Scene created', content: { 'application/json': { schema: { type: 'object', properties: { message: { type: 'string' }, id: { type: 'string' } } } } } } },
        },
      },
      '/scenes/{id}/activate': {
        post: {
          tags: ['Scenes'], operationId: 'activateScene', summary: 'Activate a scene',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { groupId: { type: 'string', description: 'Optional group to apply scene to' } } } } } },
          responses: { '200': { description: 'Success', content: { 'application/json': { schema: { $ref: '#/components/schemas/Message' } } } } },
        },
      },
      '/scenes/{id}': {
        delete: {
          tags: ['Scenes'], operationId: 'deleteScene', summary: 'Delete a scene',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Success', content: { 'application/json': { schema: { $ref: '#/components/schemas/Message' } } } } },
        },
      },
      '/all/on': {
        post: {
          tags: ['Global'], operationId: 'turnAllLightsOn', summary: 'Turn on all lights in the house',
          responses: { '200': { description: 'Success', content: { 'application/json': { schema: { $ref: '#/components/schemas/Message' } } } } },
        },
      },
      '/all/off': {
        post: {
          tags: ['Global'], operationId: 'turnAllLightsOff', summary: 'Turn off all lights in the house',
          responses: { '200': { description: 'Success', content: { 'application/json': { schema: { $ref: '#/components/schemas/Message' } } } } },
        },
      },
      '/all/color': {
        put: {
          tags: ['Global'], operationId: 'setAllLightsColor', summary: 'Set color for all lights in the house',
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['color'], properties: { color: { type: 'string', example: 'rgba(255,0,0,0.5)' } } } } } },
          responses: { '200': { description: 'Success', content: { 'application/json': { schema: { $ref: '#/components/schemas/Message' } } } } },
        },
      },
      '/bridges/discover': {
        get: {
          tags: ['Setup'], operationId: 'discoverBridges', summary: 'Discover Hue bridges on the network',
          responses: { '200': { description: 'Discovered bridges', content: { 'application/json': { schema: { type: 'object', properties: { bridges: { type: 'array', items: { type: 'object' } } } } } } } },
        },
      },
      '/bridges/auth': {
        post: {
          tags: ['Setup'], operationId: 'createAuthToken', summary: 'Create auth token (press bridge button first)',
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['bridgeIp'], properties: { bridgeIp: { type: 'string' }, appName: { type: 'string', default: 'philips-hue-mcp' }, deviceName: { type: 'string', default: 'claude-agent' } } } } } },
          responses: {
            '200': { description: 'Token created', content: { 'application/json': { schema: { type: 'object', properties: { username: { type: 'string' }, bridgeIp: { type: 'string' } } } } } },
            '428': { description: 'Bridge button not pressed' },
          },
        },
      },
      '/connection/test': {
        get: {
          tags: ['Setup'], operationId: 'testConnection', summary: 'Test bridge connection',
          responses: { '200': { description: 'Connection status', content: { 'application/json': { schema: { type: 'object', properties: { status: { type: 'string' }, bridgeIp: { type: 'string' }, lightCount: { type: 'number' } } } } } } },
        },
      },
    },
    components: {
      schemas: {
        Light: {
          type: 'object',
          properties: {
            id: { type: 'string' }, name: { type: 'string' }, type: { type: 'string' },
            on: { type: 'boolean' }, brightness: { type: 'number' },
            colorMode: { type: 'string' }, hue: { type: 'number' }, saturation: { type: 'number' },
            colorTemp: { type: 'number' }, reachable: { type: 'boolean' },
          },
        },
        Room: {
          type: 'object',
          properties: {
            id: { type: 'string' }, name: { type: 'string' }, type: { type: 'string' },
            lights: { type: 'array', items: { type: 'string' } },
            on: { type: 'boolean' }, brightness: { type: 'number' },
          },
        },
        Scene: {
          type: 'object',
          properties: {
            id: { type: 'string' }, name: { type: 'string' },
            group: { type: 'string' }, type: { type: 'string' },
          },
        },
        LightStateInput: {
          type: 'object',
          properties: {
            on: { type: 'boolean' },
            color: { type: 'string', description: 'CSS color string' },
            colorTemp: { type: 'number', minimum: 153, maximum: 500 },
            transitionTime: { type: 'number', minimum: 0, description: 'Transition in 100ms units (10=1sec)' },
          },
        },
        Message: {
          type: 'object',
          properties: { message: { type: 'string' } },
        },
      },
    },
  };
}

export function getSwaggerHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Philips Hue API</title>
  <link rel="stylesheet" href="/swagger/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="/swagger/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({ url: '/openapi.json', dom_id: '#swagger-ui', deepLinking: true });
  </script>
</body>
</html>`;
}

