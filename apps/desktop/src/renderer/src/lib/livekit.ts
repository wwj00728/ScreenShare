// LiveKit 媒体层封装：一键屏幕分享 + 观看 + 字幕
import { Room, RoomEvent, Track } from 'livekit-client';
import type { SubtitleEvent } from '@shared/types';

export interface ShareOptions {
  mode: 'detail' | 'motion'; // detail=文档/代码（保分辨率），motion=视频/游戏（保帧率）
  withMic: boolean;
}

export async function connectRoom(url: string, token: string): Promise<Room> {
  const room = new Room({ adaptiveStream: true, dynacast: true });
  await room.connect(url, token, {
    // 国内可访问的 STUN 穿透服务器（Google STUN 在部分网络被屏蔽会导致连接失败）
    rtcConfig: {
      iceServers: [
        { urls: ['stun:stun.miwifi.com:3478', 'stun:stun.chat.bilibili.com:3478'] },
      ],
    },
  });
  return room;
}

// 分享端：一键分享屏幕（Electron 内置系统选择器），可附带系统声音与麦克风
export async function startShare(
  room: Room,
  opts: ShareOptions,
): Promise<{ videoTrack: MediaStreamTrack; systemAudio?: MediaStreamTrack; micTrack?: MediaStreamTrack }> {
  // 1. 屏幕：弹出系统选择器（选显示器或窗口）
  const displayStream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: { ideal: 60, max: 60 } },
    audio: true, // Windows 系统声音；macOS 需虚拟声卡（无则忽略）
  });
  const videoTrack = displayStream.getVideoTracks()[0];
  if (!videoTrack) throw new Error('未获取到屏幕画面');
  videoTrack.contentHint = opts.mode === 'detail' ? 'detail' : 'motion';

  const settings = videoTrack.getSettings();
  const width = settings.width ?? 1920;
  // 码率按分辨率自动分档（文档 §8）
  const maxBitrate = width >= 3000 ? 35_000_000 : width >= 2000 ? 20_000_000 : 8_000_000;

  await room.localParticipant.publishTrack(videoTrack, {
    source: Track.Source.ScreenShare,
    simulcast: true,
    videoCodec: 'h264', // 第一版 H.264 保兼容（后续可协商 AV1/HEVC）
    videoEncoding: { maxBitrate, maxFramerate: 60 },
    degradationPreference: opts.mode === 'detail' ? 'maintain-resolution' : 'maintain-framerate',
  });

  // 2. 麦克风（可选）
  let micTrack: MediaStreamTrack | undefined;
  if (opts.withMic) {
    try {
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      micTrack = micStream.getAudioTracks()[0];
      if (micTrack) await room.localParticipant.publishTrack(micTrack, { source: Track.Source.Microphone });
    } catch {
      // 无权限则跳过，不影响分享
    }
  }

  // 3. 系统声音（若采集到）
  const systemAudio = displayStream.getAudioTracks()[0];
  if (systemAudio) {
    await room.localParticipant.publishTrack(systemAudio, { source: Track.Source.ScreenShareAudio });
  }

  return { videoTrack, systemAudio, micTrack };
}

export async function stopShare(room: Room, tracks: MediaStreamTrack[]) {
  for (const t of tracks) {
    try {
      await room.localParticipant.unpublishTrack(t);
    } catch {
      /* 轨道可能已停止 */
    }
    t.stop();
  }
}

// 观看端：订阅屏幕轨 + 字幕数据通道
export function setupWatcher(
  room: Room,
  videoEl: HTMLVideoElement,
  callbacks: {
    onSubtitle(e: SubtitleEvent): void;
    onScreenStarted(): void;
  },
) {
  room.on(RoomEvent.TrackSubscribed, (track) => {
    if (track.kind === 'video' && track.source === Track.Source.ScreenShare) {
      videoEl.srcObject = new MediaStream([track.mediaStreamTrack]);
      videoEl.play().catch(() => {});
      callbacks.onScreenStarted();
    }
    if (track.kind === 'audio') {
      const audio = new Audio();
      audio.srcObject = new MediaStream([track.mediaStreamTrack]);
      audio.play().catch(() => {});
    }
  });

  room.on(RoomEvent.DataReceived, (payload, _participant, _kind, topic) => {
    if (topic !== 'subtitles') return;
    try {
      const evt = JSON.parse(new TextDecoder().decode(payload)) as SubtitleEvent;
      callbacks.onSubtitle(evt);
    } catch {
      /* 忽略非法消息 */
    }
  });
}

export { Room, RoomEvent, Track };
