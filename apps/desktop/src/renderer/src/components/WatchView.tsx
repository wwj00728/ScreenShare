import { useEffect, useRef, useState } from 'react';
import type { ShareStats, SubtitleEvent } from '@shared/types';
import { connectRoom, setupWatcher, Room, RoomEvent } from '../lib/livekit';
import { StatsMeter, type PcLike } from '../lib/rtc';

export interface WatchSession {
  serverUrl: string;
  url: string;
  token: string;
  roomId: string;
}

interface Props {
  session: WatchSession;
  onExit: () => void;
}

const SPEAKER_COLORS = ['#4DA3FF', '#FF7A5C', '#5CFF8A', '#FFD35C', '#C58CFF', '#FF8CD8'];

export default function WatchView({ session, onExit }: Props) {
  const [status, setStatus] = useState('连接中…');
  const [stats, setStats] = useState<ShareStats>({});
  const [subtitles, setSubtitles] = useState<SubtitleEvent[]>([]);
  const [fullscreen, setFullscreen] = useState(false);
  const [err, setErr] = useState('');

  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const subsRef = useRef<SubtitleEvent[]>([]);
  const meterRef = useRef(new StatsMeter());

  useEffect(() => {
    let disposed = false;
    (async () => {
      try {
        const room = await connectRoom(session.url, session.token);
        if (disposed) {
          room.disconnect();
          return;
        }
        setStatus('已加入，等待画面…');

        setupWatcher(room, videoRef.current!, {
          onSubtitle: (evt) => {
            subsRef.current = mergeSubtitle(subsRef.current, evt);
            setSubtitles(subsRef.current.slice(-4));
          },
          onScreenStarted: () => setStatus('直播中'),
        });
        room.on(RoomEvent.Disconnected, () => setStatus('连接已断开'));

        const timer = setInterval(async () => {
          const pc = (room.engine as unknown as { pcManager?: { subscriber?: { pc?: PcLike } } }).pcManager
            ?.subscriber?.pc;
          setStats(await meterRef.current.sample(pc, false));
        }, 2000);
        return () => clearInterval(timer);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
        setStatus('连接失败');
      }
    })();
    return () => {
      disposed = true;
    };
  }, [session]);

  function toggleFullscreen() {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
      setFullscreen(false);
    } else {
      el.requestFullscreen();
      setFullscreen(true);
    }
  }

  return (
    <div className="watch" ref={containerRef}>
      <video ref={videoRef} className="video" playsInline autoPlay muted />

      <div className="subtitle-layer">
        {subtitles.map((s, i) => (
          <div className="subtitle-line" key={s.segmentId + i}>
            <span className="speaker" style={{ color: s.speakerColor }}>
              {s.speakerName}
            </span>
            <span className={`text ${s.isFinal ? '' : 'tmp'}`}>{s.text}</span>
          </div>
        ))}
      </div>

      <div className="watch-top">
        <span className="dot">{status}</span>
        <span className="stats">
          {stats.captureFps ? `${stats.captureFps} fps` : ''} {stats.sendBitrate ? `· ${(stats.sendBitrate / 1e6).toFixed(1)} Mbps` : ''}
          {stats.rtt ? `· RTT ${stats.rtt}ms` : ''} {stats.packetsLost ? `· 丢包 ${stats.packetsLost}` : ''}
        </span>
        <button className="ghost" onClick={toggleFullscreen}>
          {fullscreen ? '退出全屏' : '全屏'}
        </button>
        <button className="ghost" onClick={onExit}>
          退出
        </button>
      </div>

      {err && <p className="error overlay">{err}</p>}
    </div>
  );
}

// 字幕合并：isFinal 覆盖同 segmentId 的临时结果
function mergeSubtitle(list: SubtitleEvent[], evt: SubtitleEvent): SubtitleEvent[] {
  const next = [...list];
  const idx = next.findIndex((s) => s.segmentId === evt.segmentId);
  if (idx >= 0) next[idx] = evt;
  else next.push(evt);
  return next;
}
