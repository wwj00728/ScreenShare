# ScreenShare 超清屏幕分享

面向朋友小圈子的私有化超清屏幕分享：**一键分享屏幕 · 4K60 · 系统声音 · 语音聊天 · 实时字幕**。
技术方案依据《超清屏幕分享软件-项目交接文档》：Electron + React + TS 桌面客户端、Node/Fastify API、自建 LiveKit SFU、Python 字幕 Worker。

```
┌──────────────┐   HTTPS/WebSocket    ┌──────────────────────────┐
│ 分享端 Electron│ ───────────────────▶ │ 香港轻量服务器 (免备案)      │
│ (一键选屏幕分享)│                      │  ├─ Caddy (HTTPS/反向代理)  │
└──────────────┘                      │  ├─ LiveKit SFU (媒体)     │
                                      │  ├─ Node API (房间/邀请码)  │
┌──────────────┐                      │  └─ 字幕 Worker (可选)      │
│ 观看端 Electron│ ◀─────────────────── │                            │
│ (输入邀请码观看)│    UDP 50000-50200   └──────────────────────────┘
└──────────────┘
媒体（4K 视频流）只走 LiveKit，不经过 Node API。
```

## 目录结构

```
├── apps/
│   ├── desktop/                # Electron + React + TS 桌面客户端（分享端+观看端）
│   ├── api/                    # Node.js + Fastify：房间/邀请码/LiveKit JWT
│   └── transcription-worker/   # Python 实时字幕（独立麦克风模式，可选）
├── packages/shared/            # 前后端共享类型（含字幕事件、指标）
├── infra/                      # 服务器部署：docker-compose + setup.sh
├── 实施方案.md                  # 整体路线
└── 技术选型.md                  # 选型理由
```

## 一、服务器部署（一次性，约 5 分钟）

前置：腾讯云/阿里云**香港**轻量服务器（2核4G、Ubuntu 22.04、带宽峰值 ≥30Mbps），
防火墙放行 **TCP 80/443/7880/7881 + UDP 50000–50200**（UDP 段必须放行）。

```bash
# 本地电脑
scp -r infra root@<服务器IP>:/root/infra

# 服务器上
ssh root@<服务器IP>
cd /root/infra
bash setup.sh <服务器IP>
```

完成后得到：

- API：`https://screenshare.<IP>.sslip.io/api`（sslip.io 免费域名，自动 HTTPS，**无需备案**）
- LiveKit：`wss://screenshare.<IP>.sslip.io`
- 验证：浏览器打开 `https://screenshare.<IP>.sslip.io/healthz` 应返回 `{"ok":true}`

可选：启动字幕服务（需 4G+ 内存，首次下载 Whisper 模型）

```bash
docker compose --profile subtitles up -d
```

## 二、桌面客户端（分享端 & 观看端）

```bash
cd apps/desktop
npm install
npm run dev        # 开发模式（Vite + Electron 热更新）
# 或
npm run build      # 打包构建，然后 npm start 运行
```

**分享端**（最简单路径，无 OBS）：

1. 打开应用，确认顶部服务器地址为 `https://screenshare.<你的IP>.sslip.io`
2. 点 **「创建房间并分享屏幕」**
3. 点 **「开始分享屏幕」** → 系统弹出选择器，选显示器或窗口 → 立即开播
4. 把界面上显示的 **6 位邀请码** 发给朋友

**观看端**：朋友安装同一应用（或后续打包分发），在首页输入邀请码 → 加入观看，可全屏。

### 画质模式

| 模式 | 行为 | 适用 |
|---|---|---|
| 文档/代码（默认） | 优先保分辨率，网络不足先降帧率（`maintain-resolution`）| 代码、表格、网页 |
| 视频/游戏 | 优先保帧率，网络不足先降分辨率（`maintain-framerate`）| 视频、游戏画面 |

编码：第一版固定 H.264（兼容性最好、全设备硬解）；码率按分辨率自动分档
（4K→35Mbps，1440p→20Mbps，1080p→8Mbps），并开启 Simulcast 多档自适应。
后续可协商 AV1/HEVC（见《技术选型.md》）。

### 平台注意

- **macOS 首次分享**：需在 系统设置 → 隐私与安全性 → 屏幕录制 中授权本应用
- **系统声音**：Windows 采集屏幕时自动携带；macOS 需安装虚拟声卡（如 BlackHole）后把系统输出指向它
- **麦克风**：分享端可勾选"麦克风"，作为语音聊天音轨发布

## 三、API（apps/api）

Fastify + SQLite（`node:sqlite`，需 Node ≥ 22.5）。媒体数据不经过本服务。

| 接口 | 说明 |
|---|---|
| `POST /api/rooms` | 创建房间，返回 `roomId / inviteCode / ownerKey / url / token` |
| `POST /api/rooms/join` | 凭邀请码加入，返回观看 token（仅 `canSubscribe`）|
| `POST /api/rooms/renew` | 主持人凭 `ownerKey` 续期 token |
| `POST /api/rooms/remove` | 主持人移除参与者（`ownerKey + identity`）|
| `GET /api/healthz` | 健康检查 |

密钥只存在服务器环境变量（`.env`），客户端永远拿不到 API Secret。

## 四、实时字幕（可选，transcription-worker）

- 独立麦克风模式：每人一根音轨 → 按 `participantIdentity` 标记说话人（无需声纹）
- `faster-whisper`（base 模型）每 4 秒窗口转写，通过 LiveKit 数据通道
  （`topic='subtitles'`）发布字幕事件，观看端渲染为底部字幕（final 覆盖临时）
- 不保存任何原始音频
- 资源受限时可不开（分享/观看完全不受影响）；共用麦克风声纹识别为后续阶段

## 五、指标

分享端与观看端均实时显示：分辨率/帧率、发送码率、编码器、RTT、丢包
（基于 WebRTC `RTCStatsReport`，2 秒刷新）。

## 六、安全

- 全链路 HTTPS/WSS + WebRTC SRTP 加密
- 房间私密：6 位邀请码 + JWT 权限分离（观看者无发布权限）
- 主持人可移除参与者
- SSH 加固建议：`ssh-keygen && ssh-copy-id root@<IP>` 后禁用密码登录
- 服务器只开放必要端口（详见 infra/setup.sh 输出）

## 七、常见问题

- **观看端一直"等待画面"** → 检查防火墙 UDP 50000–50200 是否放行
- **邀请码无效** → 房间 token 与邀请码均有时效，重新创建房间
- **macOS 选不到屏幕** → 未授权屏幕录制（见"平台注意"）
- **人多就卡** → 香港轻量 30Mbps 峰值，Simulcast 会自动降档；要更多人看高清需提高带宽
- **字幕不显示** → 确认服务器已 `docker compose --profile subtitles up -d` 且内存 ≥4G

## 八、后续路线（文档阶段 C/D）

- 断线重连与 ICE Restart 优化、跨运营商实测
- 应用签名与自动更新、邀请链接（自定义协议唤醒）
- P2P 传输（两人房间直连，TURN 兜底）
- 原生采集核心（Windows Graphics Capture / ScreenCaptureKit + NVENC/VideoToolbox）
- AV1/HEVC 协商、4:4:4 文档模式、共用麦克风声纹识别
