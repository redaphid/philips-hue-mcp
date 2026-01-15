import { Router } from 'express';
import { HueClient } from './hue-client.js';

export function createRestApi(hueClient: HueClient, isConfigured: () => boolean) {
  const router = Router();

  // Middleware to check configuration
  router.use('/api', (req, res, next) => {
    if (!isConfigured()) {
      return res.status(503).json({ error: 'Not configured. Set HUE_BRIDGE_IP and HUE_USERNAME environment variables.' });
    }
    next();
  });

  // Health check
  router.get('/health', (req, res) => res.json({ status: 'ok', configured: isConfigured() }));

  // OpenAPI spec
  router.get('/openapi.json', (req, res) => res.json(openApiSpec));

  // ============================================
  // LIGHT ROUTES
  // ============================================

  router.get('/api/lights', async (req, res) => {
    try { res.json(await hueClient.getLights()); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  router.get('/api/lights/:id', async (req, res) => {
    try { res.json(await hueClient.getLight(req.params.id)); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  router.put('/api/lights/:id/state', async (req, res) => {
    try {
      const { on, brightness, hue, saturation, colorTemp, transitionTime } = req.body;
      await hueClient.setLightState(req.params.id, { on, bri: brightness, hue, sat: saturation, ct: colorTemp, transitiontime: transitionTime });
      res.json({ message: `Light ${req.params.id} state updated` });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  router.post('/api/lights/:id/on', async (req, res) => {
    try { await hueClient.turnLightOn(req.params.id); res.json({ message: `Light ${req.params.id} turned on` }); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  router.post('/api/lights/:id/off', async (req, res) => {
    try { await hueClient.turnLightOff(req.params.id); res.json({ message: `Light ${req.params.id} turned off` }); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ============================================
  // ROOM ROUTES
  // ============================================

  router.get('/api/rooms', async (req, res) => {
    try { res.json(await hueClient.getRooms()); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  router.get('/api/groups', async (req, res) => {
    try { res.json(await hueClient.getAllGroups()); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  router.get('/api/rooms/:id', async (req, res) => {
    try { res.json(await hueClient.getRoom(req.params.id)); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  router.put('/api/rooms/:id/state', async (req, res) => {
    try {
      const { on, brightness, hue, saturation, colorTemp, transitionTime } = req.body;
      await hueClient.setRoomState(req.params.id, { on, bri: brightness, hue, sat: saturation, ct: colorTemp, transitiontime: transitionTime });
      res.json({ message: `Room ${req.params.id} state updated` });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  router.post('/api/rooms/:id/on', async (req, res) => {
    try { await hueClient.turnRoomOn(req.params.id); res.json({ message: `Room ${req.params.id} turned on` }); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  router.post('/api/rooms/:id/off', async (req, res) => {
    try { await hueClient.turnRoomOff(req.params.id); res.json({ message: `Room ${req.params.id} turned off` }); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ============================================
  // SCENE ROUTES
  // ============================================

  router.get('/api/scenes', async (req, res) => {
    try { res.json(await hueClient.getScenes()); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  router.post('/api/scenes/:id/activate', async (req, res) => {
    try {
      await hueClient.activateScene(req.params.id, req.query.groupId as string | undefined);
      res.json({ message: `Scene ${req.params.id} activated` });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ============================================
  // GLOBAL ROUTES
  // ============================================

  router.post('/api/lights/all/on', async (req, res) => {
    try { await hueClient.setRoomState('0', { on: true }); res.json({ message: 'All lights turned on' }); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  router.post('/api/lights/all/off', async (req, res) => {
    try { await hueClient.setRoomState('0', { on: false }); res.json({ message: 'All lights turned off' }); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  return router;
}

const openApiSpec = {
  openapi: '3.0.0',
  info: { title: 'Philips Hue REST API', version: '1.0.0', description: 'REST API for controlling Philips Hue lights' },
  paths: {
    '/api/lights': {
      get: { tags: ['Lights'], summary: 'List all lights', responses: { 200: { description: 'List of lights' }, 503: { description: 'Not configured' } } }
    },
    '/api/lights/{id}': {
      get: { tags: ['Lights'], summary: 'Get a specific light', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Light details' } } }
    },
    '/api/lights/{id}/state': {
      put: { tags: ['Lights'], summary: 'Set light state', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/LightState' } } } }, responses: { 200: { description: 'State updated' } } }
    },
    '/api/lights/{id}/on': {
      post: { tags: ['Lights'], summary: 'Turn light on', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Light turned on' } } }
    },
    '/api/lights/{id}/off': {
      post: { tags: ['Lights'], summary: 'Turn light off', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Light turned off' } } }
    },
    '/api/rooms': {
      get: { tags: ['Rooms'], summary: 'List all rooms', responses: { 200: { description: 'List of rooms' } } }
    },
    '/api/groups': {
      get: { tags: ['Rooms'], summary: 'List all groups', responses: { 200: { description: 'List of groups' } } }
    },
    '/api/rooms/{id}': {
      get: { tags: ['Rooms'], summary: 'Get a specific room', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Room details' } } }
    },
    '/api/rooms/{id}/state': {
      put: { tags: ['Rooms'], summary: 'Set room state', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/LightState' } } } }, responses: { 200: { description: 'State updated' } } }
    },
    '/api/rooms/{id}/on': {
      post: { tags: ['Rooms'], summary: 'Turn room on', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Room turned on' } } }
    },
    '/api/rooms/{id}/off': {
      post: { tags: ['Rooms'], summary: 'Turn room off', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Room turned off' } } }
    },
    '/api/scenes': {
      get: { tags: ['Scenes'], summary: 'List all scenes', responses: { 200: { description: 'List of scenes' } } }
    },
    '/api/scenes/{id}/activate': {
      post: { tags: ['Scenes'], summary: 'Activate a scene', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'groupId', in: 'query', schema: { type: 'string' } }], responses: { 200: { description: 'Scene activated' } } }
    },
    '/api/lights/all/on': {
      post: { tags: ['Global'], summary: 'Turn all lights on', responses: { 200: { description: 'All lights turned on' } } }
    },
    '/api/lights/all/off': {
      post: { tags: ['Global'], summary: 'Turn all lights off', responses: { 200: { description: 'All lights turned off' } } }
    }
  },
  components: {
    schemas: {
      LightState: {
        type: 'object',
        properties: {
          on: { type: 'boolean' },
          brightness: { type: 'integer', minimum: 1, maximum: 254 },
          hue: { type: 'integer', minimum: 0, maximum: 65535 },
          saturation: { type: 'integer', minimum: 0, maximum: 254 },
          colorTemp: { type: 'integer', minimum: 153, maximum: 500 },
          transitionTime: { type: 'integer', minimum: 0 }
        }
      }
    }
  }
};
