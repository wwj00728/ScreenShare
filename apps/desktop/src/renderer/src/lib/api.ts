// 业务 API 调用（房间 / 邀请码 / JWT）
import type { RoomCreated, JoinResponse, RenewResponse } from '@shared/types';

const DEFAULT_SERVER = 'http://47.92.119.165:8080'; // 张家口服务器（免备案直连模式）

export function getServerUrl(): string {
  return localStorage.getItem('serverUrl') || DEFAULT_SERVER;
}
export function setServerUrl(u: string) {
  localStorage.setItem('serverUrl', u.replace(/\/+$/, ''));
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  // 无请求体时不发送 Content-Type，避免服务器按 JSON 解析空 body 返回 400
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(getServerUrl() + path, {
    method: 'POST',
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error || `请求失败 (${res.status})`);
  return data as T;
}

export const createRoom = () => post<RoomCreated>('/api/rooms');
export const joinRoom = (inviteCode: string) =>
  post<JoinResponse>('/api/rooms/join', { inviteCode });
export const renewRoom = (ownerKey: string) =>
  post<RenewResponse>('/api/rooms/renew', { ownerKey });
export const removeParticipant = (ownerKey: string, identity: string) =>
  post<{ ok: boolean }>('/api/rooms/remove', { ownerKey, identity });
