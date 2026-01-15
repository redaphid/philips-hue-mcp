import axios, { type AxiosInstance } from 'axios';
import https from 'node:https';

/**
 * Convert HSL values (0-1) to Hue bridge native format.
 * - h: 0-1 → hue: 0-65535
 * - s: 0-1 → sat: 0-254
 * - l: 0-1 → bri: 1-254
 */
function hslToNative(h: number, s: number, l: number): { hue: number; sat: number; bri: number } {
  return {
    hue: Math.round(Math.max(0, Math.min(1, h)) * 65535),
    sat: Math.round(Math.max(0, Math.min(1, s)) * 254),
    bri: Math.round(Math.max(0, Math.min(1, l)) * 253) + 1,
  };
}

/**
 * Simple request queue to serialize API calls to the Hue bridge.
 * Prevents parallel requests from overwhelming the hub.
 */
class RequestQueue {
  private queue: Promise<void> = Promise.resolve();

  async enqueue<T>(fn: () => Promise<T>): Promise<T> {
    let result: T;
    let error: unknown;

    this.queue = this.queue
      .then(() => fn())
      .then((r) => { result = r; })
      .catch((e) => { error = e; });

    await this.queue;

    if (error !== undefined) {
      throw error;
    }
    return result!;
  }
}

export interface HueLight {
  id: string;
  name: string;
  type: string;
  on: boolean;
  brightness: number;
  colorMode?: string;
  hue?: number;
  saturation?: number;
  colorTemp?: number;
  reachable: boolean;
}

export interface HueRoom {
  id: string;
  name: string;
  type: string;
  lights: string[];
  on: boolean;
  brightness: number;
}

export interface HueScene {
  id: string;
  name: string;
  group?: string;
  type: string;
}

export class HueClient {
  private api: AxiosInstance;
  private requestQueue = new RequestQueue();

  constructor(bridgeIp: string, username: string) {
    this.api = axios.create({
      baseURL: `https://${bridgeIp}/api/${username}`,
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      timeout: 10000,
    });
  }

  async getLights(): Promise<HueLight[]> {
    const response = await this.requestQueue.enqueue(() => this.api.get('/lights'));
    return Object.entries(response.data).map(([id, data]: [string, any]) => ({
      id,
      name: data.name,
      type: data.type,
      on: data.state.on,
      brightness: data.state.bri,
      colorMode: data.state.colormode,
      hue: data.state.hue,
      saturation: data.state.sat,
      colorTemp: data.state.ct,
      reachable: data.state.reachable,
    }));
  }

  async getLight(lightId: string): Promise<HueLight> {
    const response = await this.requestQueue.enqueue(() => this.api.get(`/lights/${lightId}`));
    const data = response.data;
    return {
      id: lightId,
      name: data.name,
      type: data.type,
      on: data.state.on,
      brightness: data.state.bri,
      colorMode: data.state.colormode,
      hue: data.state.hue,
      saturation: data.state.sat,
      colorTemp: data.state.ct,
      reachable: data.state.reachable,
    };
  }

  async setLightState(lightId: string, state: {
    on?: boolean;
    bri?: number;
    hue?: number;
    sat?: number;
    ct?: number;
    transitiontime?: number;
  }): Promise<void> {
    await this.requestQueue.enqueue(() => this.api.put(`/lights/${lightId}/state`, state));
  }

  async turnLightOn(lightId: string): Promise<void> {
    await this.setLightState(lightId, { on: true });
  }

  async turnLightOff(lightId: string): Promise<void> {
    await this.setLightState(lightId, { on: false });
  }

  async setBrightness(lightId: string, brightness: number): Promise<void> {
    await this.setLightState(lightId, { on: true, bri: Math.max(1, Math.min(254, brightness)) });
  }

  async setColor(lightId: string, hue: number, saturation: number, lightness: number): Promise<void> {
    const native = hslToNative(hue, saturation, lightness);
    await this.setLightState(lightId, { on: true, hue: native.hue, sat: native.sat, bri: native.bri });
  }

  async setColorTemp(lightId: string, colorTemp: number): Promise<void> {
    await this.setLightState(lightId, { on: true, ct: Math.max(153, Math.min(500, colorTemp)) });
  }

  async getRooms(): Promise<HueRoom[]> {
    const response = await this.requestQueue.enqueue(() => this.api.get('/groups'));
    return Object.entries(response.data)
      .filter(([, data]: [string, any]) => data.type === 'Room' || data.type === 'Zone')
      .map(([id, data]: [string, any]) => ({
        id,
        name: data.name,
        type: data.type,
        lights: data.lights,
        on: data.action?.on ?? false,
        brightness: data.action?.bri ?? 0,
      }));
  }

  async getRoom(roomId: string): Promise<HueRoom> {
    const response = await this.requestQueue.enqueue(() => this.api.get(`/groups/${roomId}`));
    const data = response.data;
    return {
      id: roomId,
      name: data.name,
      type: data.type,
      lights: data.lights,
      on: data.action?.on ?? false,
      brightness: data.action?.bri ?? 0,
    };
  }

  async setRoomState(roomId: string, state: {
    on?: boolean;
    bri?: number;
    hue?: number;
    sat?: number;
    ct?: number;
    transitiontime?: number;
  }): Promise<void> {
    await this.requestQueue.enqueue(() => this.api.put(`/groups/${roomId}/action`, state));
  }

  async turnRoomOn(roomId: string): Promise<void> {
    await this.setRoomState(roomId, { on: true });
  }

  async turnRoomOff(roomId: string): Promise<void> {
    await this.setRoomState(roomId, { on: false });
  }

  async setRoomBrightness(roomId: string, brightness: number): Promise<void> {
    await this.setRoomState(roomId, { on: true, bri: Math.max(1, Math.min(254, brightness)) });
  }

  async setRoomColor(roomId: string, hue: number, saturation: number, lightness: number): Promise<void> {
    const native = hslToNative(hue, saturation, lightness);
    await this.setRoomState(roomId, { on: true, hue: native.hue, sat: native.sat, bri: native.bri });
  }

  async setRoomColorTemp(roomId: string, colorTemp: number): Promise<void> {
    await this.setRoomState(roomId, { on: true, ct: Math.max(153, Math.min(500, colorTemp)) });
  }

  async getScenes(): Promise<HueScene[]> {
    const response = await this.requestQueue.enqueue(() => this.api.get('/scenes'));
    return Object.entries(response.data).map(([id, data]: [string, any]) => ({
      id,
      name: data.name,
      group: data.group,
      type: data.type,
    }));
  }

  async activateScene(sceneId: string, groupId?: string): Promise<void> {
    if (groupId) {
      await this.requestQueue.enqueue(() => this.api.put(`/groups/${groupId}/action`, { scene: sceneId }));
    } else {
      const scenes = await this.getScenes();
      const scene = scenes.find(s => s.id === sceneId);
      await this.requestQueue.enqueue(() => this.api.put(`/groups/${scene?.group || '0'}/action`, { scene: sceneId }));
    }
  }

  async getAllGroups(): Promise<HueRoom[]> {
    const response = await this.requestQueue.enqueue(() => this.api.get('/groups'));
    return Object.entries(response.data).map(([id, data]: [string, any]) => ({
      id,
      name: data.name,
      type: data.type,
      lights: data.lights,
      on: data.action?.on ?? false,
      brightness: data.action?.bri ?? 0,
    }));
  }
}
