// ScreenShare 主业务 API
// 职责：房间、邀请码、LiveKit JWT 签发、参与者管理。媒体数据不经过本服务。
// 存储：SQLite (node:sqlite，Node >= 22.5，需 --experimental-sqlite)
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';

const PORT = Number(process.env.API_PORT || 8080);
const DB_PATH = process.env.DB_PATH || './data.db';
const LIVEKIT_URL = process.env.LIVEKIT_URL || ''; // 客户端使用的 wss 地址
const LIVEKIT_INTERNAL_URL = process.env.LIVEKIT_INTERNAL_URL || 'http://livekit:7880'; // 容器网络内地址
const API_KEY = process.env.LIVEKIT_API_KEY || '';
const API_SECRET = process.env.LIVEKIT_API_SECRET || '';

if (!LIVEKIT_URL || !API_KEY || !API_SECRET) {
  console.error('缺少环境变量 LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET');
  process.exit(1);
}

const db = new DatabaseSync(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    invite_code TEXT UNIQUE NOT NULL,
    owner_key TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )
`);

const roomService = new RoomServiceClient(LIVEKIT_INTERNAL_URL, API_KEY, API_SECRET);

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉易混淆的 I/O/0/1
function makeInviteCode(len = 6): string {
  let code = '';
  const bytes = randomBytes(len);
  for (let i = 0; i < len; i++) code += CODE_CHARS[bytes[i] % CODE_CHARS.length];
  return code;
}

function makeToken(identity: string, room: string, grants: Record<string, unknown>, ttl: string) {
  const at = new AccessToken(API_KEY, API_SECRET, { identity, ttl });
  at.addGrant({ room, ...grants });
  return at.toJwt();
}

const app = Fastify({ logger: true });
await app.register(cors, { origin: true }); // 允许桌面/网页客户端跨域调用

interface Body { [k: string]: unknown }

// 创建房间（主持人 / 分享端）
app.post('/api/rooms', async (_req, reply) => {
  const roomId = 'room_' + randomBytes(4).toString('hex');
  const inviteCode = makeInviteCode();
  const ownerKey = randomBytes(16).toString('hex');
  db.prepare('INSERT INTO rooms (id, invite_code, owner_key, created_at) VALUES (?, ?, ?, ?)')
    .run(roomId, inviteCode, ownerKey, Date.now());
  const token = await makeToken(
    'owner-' + roomId,
    roomId,
    { roomJoin: true, roomCreate: true, roomAdmin: true, canPublish: true, canSubscribe: true },
    '2h',
  );
  reply.send({ roomId, inviteCode, ownerKey, url: LIVEKIT_URL, token });
});

// 加入房间（观看者，凭邀请码）
app.post('/api/rooms/join', async (req, reply) => {
  const body = (req.body || {}) as Body;
  const inviteCode = String(body.inviteCode || '').trim().toUpperCase();
  if (!inviteCode) return reply.code(400).send({ error: '缺少邀请码' });
  const row = db.prepare('SELECT id FROM rooms WHERE invite_code = ?').get(inviteCode) as { id: string } | undefined;
  if (!row) return reply.code(404).send({ error: '邀请码无效' });
  const token = await makeToken(
    'viewer-' + randomBytes(4).toString('hex'),
    row.id,
    { roomJoin: true, canPublish: false, canSubscribe: true },
    '2h',
  );
  reply.send({ roomId: row.id, url: LIVEKIT_URL, token, isOwner: false });
});

// 主持人续期 token（凭 ownerKey）
app.post('/api/rooms/renew', async (req, reply) => {
  const body = (req.body || {}) as Body;
  const ownerKey = String(body.ownerKey || '');
  if (!ownerKey) return reply.code(400).send({ error: '缺少 ownerKey' });
  const row = db.prepare('SELECT id FROM rooms WHERE owner_key = ?').get(ownerKey) as { id: string } | undefined;
  if (!row) return reply.code(404).send({ error: '房间不存在' });
  const token = await makeToken(
    'owner-' + row.id,
    row.id,
    { roomCreate: true, roomAdmin: true, canPublish: true, canSubscribe: true },
    '2h',
  );
  reply.send({ roomId: row.id, url: LIVEKIT_URL, token, isOwner: true });
});

// 主持人移除参与者（凭 ownerKey + 目标 identity）
app.post('/api/rooms/remove', async (req, reply) => {
  const body = (req.body || {}) as Body;
  const ownerKey = String(body.ownerKey || '');
  const identity = String(body.identity || '');
  if (!ownerKey || !identity) return reply.code(400).send({ error: '缺少参数' });
  const row = db.prepare('SELECT id FROM rooms WHERE owner_key = ?').get(ownerKey) as { id: string } | undefined;
  if (!row) return reply.code(404).send({ error: '房间不存在' });
  try {
    await roomService.removeParticipant(row.id, identity);
    reply.send({ ok: true });
  } catch (e) {
    reply.code(500).send({ error: '移除失败: ' + String(e) });
  }
});

app.get('/api/healthz', async () => ({ ok: true }));

app.listen({ port: PORT, host: '0.0.0.0' });
