import { useState } from 'react';
import { getServerUrl, setServerUrl as persistServerUrl, createRoom, joinRoom } from './lib/api';
import ShareView, { type ShareSession } from './components/ShareView';
import WatchView, { type WatchSession } from './components/WatchView';

type View =
  | { name: 'home' }
  | { name: 'share'; session: ShareSession }
  | { name: 'watch'; session: WatchSession };

export default function App() {
  const [view, setView] = useState<View>({ name: 'home' });
  const [serverUrl, setServer] = useState(getServerUrl());
  const [invite, setInvite] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  function saveServer(u: string) {
    persistServerUrl(u);
    setServer(getServerUrl());
    setErr('');
  }

  async function handleCreate() {
    setBusy(true);
    setErr('');
    try {
      const r = await createRoom();
      setView({ name: 'share', session: { ...r, serverUrl } });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleJoin() {
    if (!invite.trim()) return setErr('请输入邀请码');
    setBusy(true);
    setErr('');
    try {
      const r = await joinRoom(invite.trim());
      setView({ name: 'watch', session: { ...r, serverUrl } });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (view.name === 'share') {
    return <ShareView session={view.session} onExit={() => setView({ name: 'home' })} />;
  }
  if (view.name === 'watch') {
    return <WatchView session={view.session} onExit={() => setView({ name: 'home' })} />;
  }

  return (
    <div className="home">
      <div className="logo">SS</div>
      <h1>ScreenShare 超清屏幕分享</h1>
      <p className="sub">一键分享屏幕 · 4K60 · 系统声音 · 实时字幕</p>

      <div className="card">
        <label>
          服务器地址
          <input value={serverUrl} onChange={(e) => saveServer(e.target.value)} spellCheck={false} />
        </label>

        <button className="primary" onClick={handleCreate} disabled={busy}>
          {busy ? '连接中…' : '创建房间并分享屏幕'}
        </button>

        <div className="divider">或</div>

        <div className="row">
          <input
            placeholder="输入朋友给你的邀请码"
            value={invite}
            onChange={(e) => setInvite(e.target.value.toUpperCase())}
            maxLength={6}
            spellCheck={false}
          />
          <button onClick={handleJoin} disabled={busy || !invite.trim()}>
            加入观看
          </button>
        </div>

        {err && <p className="error">{err}</p>}
        <p className="hint">分享端：点"创建房间"后，系统会弹出选择器，选要分享的屏幕或窗口。</p>
      </div>
    </div>
  );
}
