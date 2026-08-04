"""ScreenShare 实时字幕 Worker（独立麦克风模式，文档 §9.1）

- 以受控服务身份加入房间，只订阅麦克风音轨（不碰 4K 视频）。
- 每轨独立缓冲，约 4 秒窗口送入 faster-whisper 转写。
- 按 participantIdentity 标记说话人（无需声纹），通过 LiveKit 数据通道
  （topic='subtitles'）发布字幕事件，观看端渲染。
- 默认不保存任何原始音频。

用法：需要环境变量 LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET
（由 infra/setup.sh 生成的 .env 提供，docker compose --profile subtitles up -d 启动）
"""
import asyncio
import hashlib
import json
import os
import time

from faster_whisper import WhisperModel
from livekit import rtc
from livekit.api import AccessToken, VideoGrants

URL = os.environ.get("LIVEKIT_URL", "")
KEY = os.environ.get("LIVEKIT_API_KEY", "devkey")
SECRET = os.environ.get("LIVEKIT_API_SECRET", "")
ROOM_NAME = "share"
CHUNK_MS = 4000  # 转写窗口
COLORS = ["#4DA3FF", "#FF7A5C", "#5CFF8A", "#FFD35C", "#C58CFF", "#FF8CD8"]

if not URL or not SECRET:
    raise SystemExit("缺少 LIVEKIT_URL / LIVEKIT_API_SECRET")

# faster-whisper base 模型（首次运行自动下载 ~145MB；int8 量化，2核4G 可跑）
MODEL = WhisperModel("base", device="cpu", compute_type="int8")


def transcribe(audio: bytes, sample_rate: int) -> str:
    import numpy as np

    samples = np.frombuffer(audio, dtype=np.int16).astype(np.float32) / 32768.0
    segments, _ = MODEL.transcribe(samples, beam_size=1, language="zh", vad_filter=True)
    return "".join(seg.text for seg in segments).strip()


def speaker_name(identity: str) -> str:
    if identity.startswith("owner"):
        return "主持人"
    return "观众·" + identity[-4:]


def speaker_color(identity: str) -> str:
    h = int(hashlib.md5(identity.encode()).hexdigest(), 16)
    return COLORS[h % len(COLORS)]


async def publish_subtitle(room: rtc.Room, evt: dict) -> None:
    """兼容不同 livekit 版本 publish_data 的 async/sync 差异。"""
    payload = json.dumps(evt, ensure_ascii=False).encode("utf-8")
    result = room.local_participant.publish_data(payload, reliable=True, topic="subtitles")
    if asyncio.iscoroutine(result):
        await result


async def process_track(room: rtc.Room, track: rtc.AudioTrack, participant: rtc.RemoteParticipant):
    buffer = bytearray()
    seg_counter = 0
    started_at = int(time.time() * 1000)
    print(f"[字幕] 订阅 {participant.identity} 的麦克风")
    async for frame in track.audio_frame():
        data = bytes(frame.data)
        buffer += data
        sample_rate = frame.sample_rate or 16000
        channels = max(frame.num_channels or 1, 1)
        target = sample_rate * 2 * channels * CHUNK_MS // 1000  # 16bit 字节数
        if len(buffer) >= target:
            audio = bytes(buffer)
            buffer.clear()
            text = await asyncio.to_thread(transcribe, audio, sample_rate)
            if not text:
                continue
            seg_counter += 1
            evt = {
                "speakerId": participant.identity,
                "speakerName": speaker_name(participant.identity),
                "speakerColor": speaker_color(participant.identity),
                "text": text,
                "isFinal": True,
                "segmentId": f"{participant.identity}:{seg_counter}",
                "startedAt": started_at,
                "confidence": 0.9,
            }
            try:
                await publish_subtitle(room, evt)
            except Exception as e:  # noqa: BLE001
                print(f"[字幕] 发布失败: {e}")


async def main():
    token = (
        AccessToken(KEY, SECRET)
        .with_identity("subtitle-worker")
        .with_grants(
            VideoGrants(
                room_join=True,
                room=ROOM_NAME,
                can_subscribe=True,
                can_publish_data=True,
            )
        )
        .to_jwt()
    )
    room = rtc.Room()
    await room.connect(URL, token)
    print(f"[字幕] 已加入房间 {ROOM_NAME}")

    @room.on("track_subscribed")
    def on_track_subscribed(track, publication, participant):
        if isinstance(track, rtc.AudioTrack) and publication.source == rtc.TrackSource.SOURCE_MICROPHONE:
            asyncio.ensure_future(process_track(room, track, participant))

    # 订阅已在房间内的麦克风音轨
    for participant in room.remote_participants.values():
        for pub in participant.track_publications.values():
            if pub.source == rtc.TrackSource.SOURCE_MICROPHONE:
                pub.set_subscribed(True)

    try:
        await asyncio.Event().wait()
    finally:
        await room.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
