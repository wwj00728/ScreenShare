import { useEffect, useRef, useState } from 'react';
import type { ShareStats } from '@shared/types';
import { connectRoom, startShare, stopShare, Room, RoomEvent, Track } from '../lib/livekit';
import { StatsMeter, type PcLike } from '../lib/rtc';
import { removeParticipant } from '../lib/api';

export interface ShareSession {
  serverUrl: string;
  url: string;
  token: string;
  roomId: string;
  inviteCode: string;
  ownerKey: string;
}

interface Props {
  session: ShareSession;
  onExit: () => void;
}

export default function ShareView({ session, onExit }: Props) {
  const [status, setStatus] = useState('连接服务器中…');
  const [sharing, setSharing] = useState(false);
  const [mode, setMode] = useState<'detail' | 'motion'>('detail');
  const [withMic, setWithMic] = useState(true);
  const [stats, setStats] = useState<ShareStats>({});
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState('');

  const roomRef = useRef<Room | null>(null);
  const tracksRef = useRef<MediaStreamTrack[]>([]);
  const meterRef = useRef(new StatsMeter());
  const [participants, setParticipants] = useState<{ identity: string; quality: string }[]>([]);

  useEffect(() => {
    let disposed = false;
    (async () => {
      try {
        const room = await connectRoom(session.url, session.token);
        if (disposed) {
          room.disconnect();
          return;
        }
        roomRef.current = room;
        setStatus('已连接，等待分享');

        room.on(RoomEvent.ParticipantConnected, () => refreshParticipants(room));
        room.on(RoomEvent.ParticipantDisconnected, () => refreshParticipants(room));
        room.on(RoomEvent.ConnectionQualityChanged, () => refreshParticipants(room));
        room.on(RoomEvent.Disconnected, () => {
          if (!disposed) setStatus('连接已断开');
        });
        refreshParticipants(room);

        // 指标轮询：本地分享轨的发送统计
        const timer = setInterval(async () => {
          const pc = (room.engine as unknown as { pcManager?: { publisher?: { pc?: PcLike } } }).pcManager
            ?.publisher?.pc;
          setStats(await meterRef.current.sample(pc, true));
        }, 2000);
        return () => clearInterval(timer);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
        setStatus('连接失败');
      }
    })();
    return () => {
      disposed = true;
      if (roomRef.current) roomRef.current.disconnect();
    };
  }, [session]);

  function refreshParticipants(room: Room) {
    const list: { identity: string; quality: string }[] = [];
    room.remoteParticipants.forEach((p) => {
      list.push({ identity: p.identity, quality: p.connectionQuality });
    });
    setParticipants(list);
  }

  async function handleStart() {
    const room = roomRef.current;
    if (!room) return;
    setErr('');
    try {
      setStatus('正在选择要分享的屏幕…');
      const t = await startShare(room, { mode, withMic });
      tracksRef.current = [t.videoTrack, ...(t.systemAudio ? [t.systemAudio] : []), ...(t.micTrack ? [t.micTrack] : [])];
      setSharing(true);
      const settings = t.videoTrack.getSettings();
      setStatus(`分享中 ${settings.width}×${settings.height} @ ${Math.round(settings.frameRate || 60)}fps`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setStatus('未开始分享');
    }
  }

  async function handleStop() {
    const room = roomRef.current;
    if (!room) return;
    await stopShare(room, tracksRef.current);
    tracksRef.current = [];
    setSharing(false);
    setStatus('已停止分享');
  }

  async function handleRemove(identity: string) {
    try {
      await removeParticipant(session.ownerKey, identity);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  function copyInvite() {
    navigator.clipboard.writeText(session.inviteCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="view">
      <header className="bar">
        <span className="title">分享端</span>
        <span className={`dot ${sharing ? 'live' : ''}`}>{sharing ? '● 分享中' : status}</span>
        <button className="ghost" onClick={onExit}>
          返回
        </button>
      </header>

      <main className="share-main">
        <section className="card invite">
          <p className="label">邀请码（发给朋友）</p>
          <div className="invite-row">
            <code className="invite-code">{session.inviteCode}</code>
            <button onClick={copyInvite}>{copied ? '已复制' : '复制'}</button>
          </div>
          <p className="hint">朋友在应用首页输入此 6 位邀请码即可观看</p>
        </section>

        <section className="card">
          <div className="row">
            <button className="primary big" onClick={sharing ? handleStop : handleStart}>
              {sharing ? '停止分享' : '开始分享屏幕'}
            </button>
            <label className="switch">
              <input type="checkbox" checked={withMic} onChange={(e) => setWithMic(e.target.checked)} disabled={sharing} />
              麦克风
            </label>
            <label className="switch">
              <input
                type="checkbox"
                checked={mode === 'motion'}
                onChange={(e) => setMode(e.target.checked ? 'motion' : 'detail')}
                disabled={sharing}
              />
              视频/游戏模式（保帧率）
            </label>
          </div>
          <p className="hint">默认"文档/代码"模式（优先保分辨率，文字清晰）；分享视频/游戏时切换模式。</p>
        </section>

        <section className="card">
          <div className="stats-grid">
            <div><span className="label">分辨率</span><span className="value">{stats.captureWidth ? `${stats.captureWidth}×${stats.captureHeight}` : '—'}</span></div>
            <div><span className="label">发送码率</span><span className="value">{stats.sendBitrate ? `${(stats.sendBitrate / 1e6).toFixed(1)} Mbps` : '—'}</span></div>
            <div><span className="label">编码器</span><span className="value">{stats.codec || '—'}</span></div>
            <div><span className="label">RTT</span><span className="value">{stats.rtt ? `${stats.rtt} ms` : '—'}</span></div>
          </div>
        </section>

        <section className="card">
          <p className="label">房间内成员</p>
          {participants.length === 0 && <p className="hint">还没有人加入</p>}
          {participants.map((p) => (
            <div className="row between" key={p.identity}>
              <span>
                {p.identity} <em className="quality">{p.quality}</em>
              </span>
              <button className="danger" onClick={() => handleRemove(p.identity)}>
                移除
              </button>
            </div>
          ))}
        </section>

        {err && <p className="error">{err}</p>}
      </main>
    </div>
  );
}
