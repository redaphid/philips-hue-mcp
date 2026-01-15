import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { HueClient } from './hue-client.js';
import { randomUUID } from 'node:crypto';
import axios from 'axios';
import https from 'node:https';

const HUE_BRIDGE_IP = process.env.HUE_BRIDGE_IP || '';
const HUE_USERNAME = process.env.HUE_USERNAME || '';
const PORT = parseInt(process.env.PORT || '3100', 10);

const hueClient = new HueClient(HUE_BRIDGE_IP, HUE_USERNAME);

const server = new McpServer({
  name: 'philips-hue-mcp',
  version: '1.0.0',
});

// List all lights
server.registerTool('list_lights', {
  title: 'List Lights',
  description: 'Get a list of all Philips Hue lights with their current state',
}, async () => {
  try {
    const lights = await hueClient.getLights();
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(lights, null, 2),
        },
      ],
    };
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

// Get single light details
server.registerTool('get_light', {
  title: 'Get Light',
  description: 'Get details of a specific light by its ID',
  inputSchema: z.object({
    lightId: z.string().describe('The ID of the light to get'),
  }),
}, async ({ lightId }) => {
  try {
    const light = await hueClient.getLight(lightId);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(light, null, 2),
        },
      ],
    };
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

// Turn light on
server.registerTool('turn_light_on', {
  title: 'Turn Light On',
  description: 'Turn on a specific light',
  inputSchema: z.object({
    lightId: z.string().describe('The ID of the light to turn on'),
  }),
}, async ({ lightId }) => {
  try {
    await hueClient.turnLightOn(lightId);
    return {
      content: [{ type: 'text', text: `Light ${lightId} turned on` }],
    };
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

// Turn light off
server.registerTool('turn_light_off', {
  title: 'Turn Light Off',
  description: 'Turn off a specific light',
  inputSchema: z.object({
    lightId: z.string().describe('The ID of the light to turn off'),
  }),
}, async ({ lightId }) => {
  try {
    await hueClient.turnLightOff(lightId);
    return {
      content: [{ type: 'text', text: `Light ${lightId} turned off` }],
    };
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

// Set light brightness
server.registerTool('set_light_brightness', {
  title: 'Set Light Brightness',
  description: 'Set the brightness of a specific light (1-254)',
  inputSchema: z.object({
    lightId: z.string().describe('The ID of the light'),
    brightness: z.number().min(1).max(254).describe('Brightness value (1-254)'),
  }),
}, async ({ lightId, brightness }) => {
  try {
    await hueClient.setBrightness(lightId, brightness);
    return {
      content: [{ type: 'text', text: `Light ${lightId} brightness set to ${brightness}` }],
    };
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

// Set light color
server.registerTool('set_light_color', {
  title: 'Set Light Color',
  description: 'Set the color of a specific light using hue (0-65535) and saturation (0-254)',
  inputSchema: z.object({
    lightId: z.string().describe('The ID of the light'),
    hue: z.number().min(0).max(65535).describe('Hue value (0-65535, where 0/65535=red, ~21845=green, ~43690=blue)'),
    saturation: z.number().min(0).max(254).describe('Saturation value (0-254, 0=white, 254=full color)'),
  }),
}, async ({ lightId, hue, saturation }) => {
  try {
    await hueClient.setColor(lightId, hue, saturation);
    return {
      content: [{ type: 'text', text: `Light ${lightId} color set to hue=${hue}, saturation=${saturation}` }],
    };
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

// Set light color temperature
server.registerTool('set_light_color_temp', {
  title: 'Set Light Color Temperature',
  description: 'Set the color temperature of a specific light in mireds (153-500, lower=cooler/bluer, higher=warmer/yellower)',
  inputSchema: z.object({
    lightId: z.string().describe('The ID of the light'),
    colorTemp: z.number().min(153).max(500).describe('Color temperature in mireds (153=cool daylight, 500=warm candlelight)'),
  }),
}, async ({ lightId, colorTemp }) => {
  try {
    await hueClient.setColorTemp(lightId, colorTemp);
    return {
      content: [{ type: 'text', text: `Light ${lightId} color temperature set to ${colorTemp} mireds` }],
    };
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

// Set full light state
server.registerTool('set_light_state', {
  title: 'Set Light State',
  description: 'Set multiple properties of a light at once',
  inputSchema: z.object({
    lightId: z.string().describe('The ID of the light'),
    on: z.boolean().optional().describe('Turn light on or off'),
    brightness: z.number().min(1).max(254).optional().describe('Brightness (1-254)'),
    hue: z.number().min(0).max(65535).optional().describe('Hue (0-65535)'),
    saturation: z.number().min(0).max(254).optional().describe('Saturation (0-254)'),
    colorTemp: z.number().min(153).max(500).optional().describe('Color temperature in mireds'),
    transitionTime: z.number().min(0).optional().describe('Transition time in 100ms increments (e.g., 10 = 1 second)'),
  }),
}, async ({ lightId, on, brightness, hue, saturation, colorTemp, transitionTime }) => {
  try {
    await hueClient.setLightState(lightId, {
      on,
      bri: brightness,
      hue,
      sat: saturation,
      ct: colorTemp,
      transitiontime: transitionTime,
    });
    return {
      content: [{ type: 'text', text: `Light ${lightId} state updated` }],
    };
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

// List rooms/groups
server.registerTool('list_rooms', {
  title: 'List Rooms',
  description: 'Get a list of all rooms and zones',
}, async () => {
  try {
    const rooms = await hueClient.getRooms();
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(rooms, null, 2),
        },
      ],
    };
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

// List all groups (including entertainment areas)
server.registerTool('list_groups', {
  title: 'List All Groups',
  description: 'Get a list of all groups including rooms, zones, and entertainment areas',
}, async () => {
  try {
    const groups = await hueClient.getAllGroups();
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(groups, null, 2),
        },
      ],
    };
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

// Get room details
server.registerTool('get_room', {
  title: 'Get Room',
  description: 'Get details of a specific room by its ID',
  inputSchema: z.object({
    roomId: z.string().describe('The ID of the room'),
  }),
}, async ({ roomId }) => {
  try {
    const room = await hueClient.getRoom(roomId);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(room, null, 2),
        },
      ],
    };
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

// Turn room on
server.registerTool('turn_room_on', {
  title: 'Turn Room On',
  description: 'Turn on all lights in a room',
  inputSchema: z.object({
    roomId: z.string().describe('The ID of the room'),
  }),
}, async ({ roomId }) => {
  try {
    await hueClient.turnRoomOn(roomId);
    return {
      content: [{ type: 'text', text: `Room ${roomId} turned on` }],
    };
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

// Turn room off
server.registerTool('turn_room_off', {
  title: 'Turn Room Off',
  description: 'Turn off all lights in a room',
  inputSchema: z.object({
    roomId: z.string().describe('The ID of the room'),
  }),
}, async ({ roomId }) => {
  try {
    await hueClient.turnRoomOff(roomId);
    return {
      content: [{ type: 'text', text: `Room ${roomId} turned off` }],
    };
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

// Set room brightness
server.registerTool('set_room_brightness', {
  title: 'Set Room Brightness',
  description: 'Set the brightness of all lights in a room (1-254)',
  inputSchema: z.object({
    roomId: z.string().describe('The ID of the room'),
    brightness: z.number().min(1).max(254).describe('Brightness value (1-254)'),
  }),
}, async ({ roomId, brightness }) => {
  try {
    await hueClient.setRoomBrightness(roomId, brightness);
    return {
      content: [{ type: 'text', text: `Room ${roomId} brightness set to ${brightness}` }],
    };
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

// Set room color
server.registerTool('set_room_color', {
  title: 'Set Room Color',
  description: 'Set the color of all lights in a room using hue and saturation',
  inputSchema: z.object({
    roomId: z.string().describe('The ID of the room'),
    hue: z.number().min(0).max(65535).describe('Hue value (0-65535)'),
    saturation: z.number().min(0).max(254).describe('Saturation value (0-254)'),
  }),
}, async ({ roomId, hue, saturation }) => {
  try {
    await hueClient.setRoomColor(roomId, hue, saturation);
    return {
      content: [{ type: 'text', text: `Room ${roomId} color set to hue=${hue}, saturation=${saturation}` }],
    };
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

// Set room color temperature
server.registerTool('set_room_color_temp', {
  title: 'Set Room Color Temperature',
  description: 'Set the color temperature of all lights in a room in mireds',
  inputSchema: z.object({
    roomId: z.string().describe('The ID of the room'),
    colorTemp: z.number().min(153).max(500).describe('Color temperature in mireds (153-500)'),
  }),
}, async ({ roomId, colorTemp }) => {
  try {
    await hueClient.setRoomColorTemp(roomId, colorTemp);
    return {
      content: [{ type: 'text', text: `Room ${roomId} color temperature set to ${colorTemp} mireds` }],
    };
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

// Set room state
server.registerTool('set_room_state', {
  title: 'Set Room State',
  description: 'Set multiple properties of all lights in a room at once',
  inputSchema: z.object({
    roomId: z.string().describe('The ID of the room'),
    on: z.boolean().optional().describe('Turn lights on or off'),
    brightness: z.number().min(1).max(254).optional().describe('Brightness (1-254)'),
    hue: z.number().min(0).max(65535).optional().describe('Hue (0-65535)'),
    saturation: z.number().min(0).max(254).optional().describe('Saturation (0-254)'),
    colorTemp: z.number().min(153).max(500).optional().describe('Color temperature in mireds'),
    transitionTime: z.number().min(0).optional().describe('Transition time in 100ms increments'),
  }),
}, async ({ roomId, on, brightness, hue, saturation, colorTemp, transitionTime }) => {
  try {
    await hueClient.setRoomState(roomId, {
      on,
      bri: brightness,
      hue,
      sat: saturation,
      ct: colorTemp,
      transitiontime: transitionTime,
    });
    return {
      content: [{ type: 'text', text: `Room ${roomId} state updated` }],
    };
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

// List scenes
server.registerTool('list_scenes', {
  title: 'List Scenes',
  description: 'Get a list of all available scenes',
}, async () => {
  try {
    const scenes = await hueClient.getScenes();
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(scenes, null, 2),
        },
      ],
    };
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

// Activate scene
server.registerTool('activate_scene', {
  title: 'Activate Scene',
  description: 'Activate a specific scene',
  inputSchema: z.object({
    sceneId: z.string().describe('The ID of the scene to activate'),
    groupId: z.string().optional().describe('Optional group ID to apply the scene to'),
  }),
}, async ({ sceneId, groupId }) => {
  try {
    await hueClient.activateScene(sceneId, groupId);
    return {
      content: [{ type: 'text', text: `Scene ${sceneId} activated${groupId ? ` in group ${groupId}` : ''}` }],
    };
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

// Turn all lights off
server.registerTool('turn_all_lights_off', {
  title: 'Turn All Lights Off',
  description: 'Turn off all lights in the house',
}, async () => {
  try {
    await hueClient.setRoomState('0', { on: false });
    return {
      content: [{ type: 'text', text: 'All lights turned off' }],
    };
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

// Turn all lights on
server.registerTool('turn_all_lights_on', {
  title: 'Turn All Lights On',
  description: 'Turn on all lights in the house',
}, async () => {
  try {
    await hueClient.setRoomState('0', { on: true });
    return {
      content: [{ type: 'text', text: 'All lights turned on' }],
    };
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

// ============================================
// SETUP & AUTHENTICATION TOOLS
// ============================================

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// Resource: Setup instructions
server.registerResource('setup-guide', 'hue://setup-guide', {
  title: 'Philips Hue Setup Guide',
  description: 'Instructions for setting up authentication with a Philips Hue bridge',
  mimeType: 'text/markdown',
}, async () => {
  return {
    contents: [{
      uri: 'hue://setup-guide',
      mimeType: 'text/markdown',
      text: `# Philips Hue Bridge Setup Guide

## Overview
To control Philips Hue lights, you need two things:
1. **Bridge IP Address** - The local IP of your Hue bridge
2. **Username (Auth Token)** - A unique token that authorizes API access

## Step 1: Discover Your Bridge

Use the \`discover_bridges\` tool to find Hue bridges on your network.
This will return a list of bridges with their IP addresses.

Alternatively, check your router's admin panel for a device named "Philips-hue".

## Step 2: Create an Auth Token

**IMPORTANT: You must physically press the button on top of your Hue bridge before running this step!**

1. Go to your Hue bridge (the square device connected to your router)
2. Press the large button on top of the bridge
3. Within 30 seconds, use the \`create_auth_token\` tool with your bridge IP
4. Save the returned username - this is your auth token

## Step 3: Configure the MCP Server

Set these environment variables before starting the server:

\`\`\`bash
export HUE_BRIDGE_IP="<your-bridge-ip>"
export HUE_USERNAME="<your-auth-token>"
\`\`\`

Or create a \`.env\` file:
\`\`\`
HUE_BRIDGE_IP=192.168.1.x
HUE_USERNAME=your-token-here
\`\`\`

## Troubleshooting

- **"link button not pressed"** - You need to press the physical button on the bridge first, then retry within 30 seconds
- **Bridge not found** - Ensure the bridge is powered on and connected to your network
- **Connection timeout** - Check that your computer is on the same network as the bridge

## Security Notes

- Keep your auth token secret - anyone with it can control your lights
- The token doesn't expire, but you can delete it from the bridge using the Hue app
- Each application should have its own token for easy revocation
`,
    }],
  };
});

// Tool: Discover Hue bridges on the network
server.registerTool('discover_bridges', {
  title: 'Discover Bridges',
  description: 'Discover Philips Hue bridges on your local network using the Hue discovery service',
}, async () => {
  try {
    // Use Philips Hue discovery endpoint
    const response = await axios.get('https://discovery.meethue.com/', { timeout: 10000 });
    const bridges = response.data;

    if (!bridges || bridges.length === 0) {
      return {
        content: [{
          type: 'text',
          text: 'No Hue bridges found on the network. Make sure your bridge is powered on and connected to the same network.',
        }],
      };
    }

    return {
      content: [{
        type: 'text',
        text: `Found ${bridges.length} Hue bridge(s):\n\n${JSON.stringify(bridges, null, 2)}\n\nUse the bridge IP address with the create_auth_token tool to authenticate.`,
      }],
    };
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error discovering bridges: ${error.message}` }],
      isError: true,
    };
  }
});

// Tool: Create auth token (requires button press)
server.registerTool('create_auth_token', {
  title: 'Create Auth Token',
  description: 'Create a new auth token for the Hue bridge. IMPORTANT: You must press the button on the Hue bridge first, then call this within 30 seconds!',
  inputSchema: z.object({
    bridgeIp: z.string().describe('The IP address of the Hue bridge'),
    appName: z.string().optional().describe('Application name (default: phillips-hue-mcp)'),
    deviceName: z.string().optional().describe('Device name (default: claude-agent)'),
  }),
}, async ({ bridgeIp, appName = 'phillips-hue-mcp', deviceName = 'claude-agent' }) => {
  try {
    const response = await axios.post(
      `https://${bridgeIp}/api`,
      { devicetype: `${appName}#${deviceName}` },
      { httpsAgent, timeout: 10000 }
    );

    const result = response.data;

    // Check for errors
    if (Array.isArray(result) && result[0]?.error) {
      const error = result[0].error;
      if (error.type === 101) {
        return {
          content: [{
            type: 'text',
            text: `⚠️ Link button not pressed!\n\nPlease:\n1. Press the button on top of your Hue bridge\n2. Run this tool again within 30 seconds\n\nThe button is the large circular button on the top of the bridge.`,
          }],
        };
      }
      return {
        content: [{ type: 'text', text: `Error from bridge: ${error.description}` }],
        isError: true,
      };
    }

    // Success - extract username
    if (Array.isArray(result) && result[0]?.success?.username) {
      const username = result[0].success.username;
      return {
        content: [{
          type: 'text',
          text: `✅ Auth token created successfully!\n\n**Your new auth token:** \`${username}\`\n\n**To use this token, set these environment variables:**\n\`\`\`bash\nexport HUE_BRIDGE_IP="${bridgeIp}"\nexport HUE_USERNAME="${username}"\n\`\`\`\n\n**Or add to your .mcp.json:**\n\`\`\`json\n{\n  "mcpServers": {\n    "phillips-hue": {\n      "type": "streamable-http",\n      "url": "http://localhost:3100/mcp",\n      "env": {\n        "HUE_BRIDGE_IP": "${bridgeIp}",\n        "HUE_USERNAME": "${username}"\n      }\n    }\n  }\n}\n\`\`\`\n\n⚠️ Keep this token secret! Anyone with it can control your lights.`,
        }],
      };
    }

    return {
      content: [{ type: 'text', text: `Unexpected response from bridge: ${JSON.stringify(result)}` }],
      isError: true,
    };
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error creating auth token: ${error.message}` }],
      isError: true,
    };
  }
});

// Tool: Test connection
server.registerTool('test_connection', {
  title: 'Test Connection',
  description: 'Test the connection to the Hue bridge with current credentials',
}, async () => {
  if (!HUE_BRIDGE_IP || !HUE_USERNAME) {
    return {
      content: [{
        type: 'text',
        text: `❌ Not configured!\n\nMissing environment variables:\n${!HUE_BRIDGE_IP ? '- HUE_BRIDGE_IP\n' : ''}${!HUE_USERNAME ? '- HUE_USERNAME\n' : ''}\nUse the discover_bridges and create_auth_token tools to set up authentication, or read the setup-guide resource for instructions.`,
      }],
    };
  }

  try {
    const lights = await hueClient.getLights();
    return {
      content: [{
        type: 'text',
        text: `✅ Connection successful!\n\nBridge IP: ${HUE_BRIDGE_IP}\nFound ${lights.length} lights.\n\nYou're ready to control your Hue lights!`,
      }],
    };
  } catch (error: any) {
    return {
      content: [{
        type: 'text',
        text: `❌ Connection failed!\n\nBridge IP: ${HUE_BRIDGE_IP}\nError: ${error.message}\n\nCheck that:\n1. The bridge IP is correct\n2. Your auth token is valid\n3. You're on the same network as the bridge`,
      }],
      isError: true,
    };
  }
});

// Store active transports by session ID
const transports: Record<string, StreamableHTTPServerTransport> = {};

function log(message: string, data?: unknown) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
  if (data !== undefined) {
    console.log(JSON.stringify(data, null, 2));
  }
}

async function main() {
  const app = createMcpExpressApp({ host: '0.0.0.0' });

  // Log all incoming requests
  app.use((req, res, next) => {
    log(`${req.method} ${req.path}`, {
      headers: req.headers,
      body: req.body,
    });
    next();
  });

  app.post('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    log(`POST /mcp - session: ${sessionId || 'none'}`);

    try {
      let transport: StreamableHTTPServerTransport;

      if (sessionId && transports[sessionId]) {
        // Reuse existing transport
        log(`Reusing transport for session: ${sessionId}`);
        transport = transports[sessionId];
      } else if (!sessionId && isInitializeRequest(req.body)) {
        // New initialization request
        log('New initialization request, creating transport');
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => {
            log(`Session initialized: ${sid}`);
            transports[sid] = transport;
          },
        });

        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid && transports[sid]) {
            log(`Transport closed, removing session: ${sid}`);
            delete transports[sid];
          }
        };

        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
        return;
      } else {
        // Invalid request
        log('Bad request: no session ID and not an initialize request');
        res.status(400).json({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
          id: null,
        });
        return;
      }

      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      log('Error handling POST request', error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  });

  app.get('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    log(`GET /mcp - session: ${sessionId || 'none'}`);

    if (!sessionId || !transports[sessionId]) {
      res.status(400).send('Invalid or missing session ID');
      return;
    }

    const transport = transports[sessionId];
    await transport.handleRequest(req, res);
  });

  app.delete('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    log(`DELETE /mcp - session: ${sessionId || 'none'}`);

    if (!sessionId || !transports[sessionId]) {
      res.status(400).send('Invalid or missing session ID');
      return;
    }

    try {
      const transport = transports[sessionId];
      await transport.handleRequest(req, res);
    } catch (error) {
      log('Error handling DELETE request', error);
      if (!res.headersSent) {
        res.status(500).send('Error processing session termination');
      }
    }
  });

  app.listen(PORT, () => {
    log(`Philips Hue MCP server running on http://0.0.0.0:${PORT}/mcp`);
    log(`Bridge IP: ${HUE_BRIDGE_IP}`);
  });
}

main().catch(console.error);
