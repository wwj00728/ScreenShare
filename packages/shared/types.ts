// ScreenShare 前后端共享类型（纯类型，无运行时依赖）

export interface RoomCreated {
  roomId: string;
  inviteCode: string;
  ownerKey: string; // 主持人密钥，仅分享端保存，用于续期/管理
  url: string; // LiveKit wss 地址
  token: string; // 主持人 JWT
}

export interface JoinResponse {
  roomId: string;
  url: string;
  token: string;
  isOwner: boolean;
}

export interface RenewResponse {
  roomId: string;
  url: string;
  token: string;
  isOwner: boolean;
}

// 字幕事件（文档 §9.1，独立麦克风模式）
export interface SubtitleEvent {
  speakerId: string;
  speakerName: string;
  speakerColor: string;
  text: string;
  isFinal: boolean; // false = 临时结果，true = 最终结果
  segmentId: string;
  startedAt: number;
  confidence?: number;
}

// 连接指标（文档 §13）
export interface ShareStats {
  captureWidth?: number;
  captureHeight?: number;
  captureFps?: number;
  sendBitrate?: number; // bps
  codec?: string;
  rtt?: number; // ms
  packetsLost?: number;
  quality?: string;
}
