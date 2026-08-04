// WebRTC 实时指标采集（基于 PCTransport.getStats()，标准 RTCStatsReport）
import type { ShareStats } from '@shared/types';

export interface PcLike {
  getStats(): Promise<RTCStatsReport>;
}

export class StatsMeter {
  private prevBytes = new Map<string, number>();
  private prevTime = 0;

  async sample(pc: PcLike | null | undefined, isSender: boolean): Promise<ShareStats> {
    const out: ShareStats = {};
    if (!pc) return out;

    let report: RTCStatsReport;
    try {
      report = await pc.getStats();
    } catch {
      return out;
    }

    const codecs = new Map<string, string>();
    report.forEach((s) => {
      if (s.type === 'codec' && (s as unknown as { mimeType?: string }).mimeType) {
        codecs.set(s.id, (s as unknown as { mimeType: string }).mimeType.replace('video/', ''));
      }
    });

    const now = Date.now();
    let bytes = 0;
    let rtt = 0;
    let packetsLost = 0;
    let fps: number | undefined;
    let codec: string | undefined;
    let width: number | undefined;
    let height: number | undefined;

    report.forEach((s) => {
      const stat = s as unknown as Record<string, unknown>;
      if (s.type === 'candidate-pair' && stat.nominated && typeof stat.currentRoundTripTime === 'number') {
        rtt = (stat.currentRoundTripTime as number) * 1000;
      }
      if (isSender && s.type === 'outbound-rtp' && stat.kind === 'video') {
        bytes = Number(stat.bytesSent || 0);
        fps = stat.framesPerSecond as number | undefined;
        codec = stat.codecId as string | undefined;
        width = stat.frameWidth as number | undefined;
        height = stat.frameHeight as number | undefined;
      }
      if (!isSender && s.type === 'inbound-rtp' && stat.kind === 'video') {
        bytes = Number(stat.bytesReceived || 0);
        packetsLost = Number(stat.packetsLost || 0);
        codec = stat.codecId as string | undefined;
        width = stat.frameWidth as number | undefined;
        height = stat.frameHeight as number | undefined;
      }
    });

    const key = isSender ? 'out' : 'in';
    const prev = this.prevBytes.get(key);
    const dt = now - this.prevTime;
    if (prev !== undefined && dt > 0) {
      out.sendBitrate = Math.round(((bytes - prev) * 8) / (dt / 1000)); // bps
    }
    this.prevBytes.set(key, bytes);
    this.prevTime = now;

    if (rtt > 0) out.rtt = Math.round(rtt);
    if (fps !== undefined) out.captureFps = Math.round(fps);
    if (width !== undefined && height !== undefined) {
      out.captureWidth = width;
      out.captureHeight = height;
    }
    if (packetsLost > 0) out.packetsLost = packetsLost;
    if (codec && codecs.has(codec)) out.codec = codecs.get(codec);
    return out;
  }
}
