#!/usr/bin/env bash
# =============================================================
# ScreenShare 服务器一键部署（腾讯云/阿里云轻量 · Ubuntu 22.04）
# 部署: LiveKit(SFU) + Node API(房间/邀请码/JWT) + Caddy(HTTPS)
# 用法: bash setup.sh [公网IP] [模式]
#   模式: domain = 域名HTTPS（默认，境外服务器免备案用 sslip.io）
#        direct = 免备案IP直连（大陆服务器/未备案时用，不走 80/443）
# =============================================================
set -euo pipefail

IP="${1:-$(curl -s4 --max-time 5 ifconfig.me || true)}"
MODE="${2:-domain}"
if [ -z "$IP" ]; then
  echo "错误: 无法自动获取公网 IP，请手动指定: bash setup.sh <公网IP>" >&2
  exit 1
fi
DOMAIN="screenshare.${IP}.sslip.io"
echo "==> 公网 IP : ${IP}"
if [ "$MODE" = "direct" ]; then
  echo "==> 模式    : 免备案直连 (API=http://${IP}:8080, LiveKit=ws://${IP}:7880)"
else
  echo "==> 模式    : 域名 HTTPS (https://${DOMAIN}，境外免备案)"
fi

# ---------- 0. 确保 swap（2G 内存机器防 OOM 死机） ----------
if ! swapon --show 2>/dev/null | grep -q swapfile; then
  echo "==> 创建 2G swap 内存保险..."
  fallocate -l 2G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q swapfile /etc/fstab 2>/dev/null || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# ---------- 1. 安装 Docker（大陆环境用国内源） ----------
if ! command -v docker >/dev/null 2>&1; then
  echo "==> 安装 Docker（国内源）..."
  curl -fsSL https://get.daocloud.io/docker | sh || {
    echo "国内源失败，尝试官方源..."; curl -fsSL https://get.docker.com | sh; }
  systemctl enable docker 2>/dev/null || true
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "==> 安装 docker compose 插件..."
  apt-get update -qq && apt-get install -y docker-compose-plugin
fi
# 配置国内 Docker 镜像加速 + 关闭 userland-proxy（大陆拉镜像/低配机防卡死）
mkdir -p /etc/docker
cat > /etc/docker/daemon.json <<EOF
{
  "registry-mirrors": ["https://docker.m.daocloud.io", "https://docker.1ms.run"],
  "userland-proxy": false
}
EOF
systemctl restart docker 2>/dev/null || true

# ---------- 2. 生成密钥（已存在则复用，保证脚本幂等可重跑） ----------
API_KEY="devkey"
if [ -f .env ] && grep -q "^LIVEKIT_API_SECRET=" .env; then
  API_SECRET="$(grep '^LIVEKIT_API_SECRET=' .env | head -1 | cut -d= -f2)"
  echo "==> 复用已有 API 密钥 (key=${API_KEY})"
else
  API_SECRET="$(openssl rand -hex 24)"
  echo "==> 已生成 API 密钥 (key=${API_KEY})"
fi

# ---------- 3. livekit.yaml ----------
cat > livekit.yaml <<EOF
port: 7880
rtc:
  tcp_port: 7881
  port_range_start: 50000
  port_range_end: 50200
  use_external_ip: false
  node_ip: ${IP}
keys:
  ${API_KEY}: ${API_SECRET}
logging:
  level: info
EOF

# ---------- 4. .env（compose / API / 字幕 Worker 共用） ----------
mkdir -p data
if [ "$MODE" = "direct" ]; then
  LIVEKIT_URL_ENTRY="ws://${IP}:7880"
else
  LIVEKIT_URL_ENTRY="wss://${DOMAIN}"
fi
cat > .env <<EOF
DOMAIN=${DOMAIN}
LIVEKIT_URL=${LIVEKIT_URL_ENTRY}
LIVEKIT_API_KEY=${API_KEY}
LIVEKIT_API_SECRET=${API_SECRET}
DB_PATH=/data/screenshare.db
EOF

# ---------- 5. Caddyfile ----------
cat > Caddyfile <<EOF
${DOMAIN} {
	# LiveKit 信令 (WebSocket)
	handle /rtc* {
		reverse_proxy livekit:7880
	}
	# 业务 API（房间 / 邀请码 / JWT）
	handle /api/* {
		reverse_proxy api:8080
	}
	handle /healthz {
		respond "ok"
	}
}
EOF

# ---------- 6. 串行预拉大镜像（低配机器防 OOM） ----------
echo "==> 预拉取 livekit 镜像（可能需要几分钟，请耐心等待）..."
docker pull livekit/livekit-server:latest
if [ "$MODE" = "direct" ]; then
  # 免备案直连模式：不启动 Caddy，客户端直连 LiveKit(7880) 与 API(8080)
  echo "==> 构建并启动服务（免备案直连模式）..."
  docker compose up -d --build livekit api
else
  echo "==> 预拉取 caddy 镜像..."
  docker pull caddy:2
  echo "==> 构建并启动服务（首次约 2-5 分钟）..."
  docker compose up -d --build
fi

echo ""
echo "================ 部署完成 ================"
if [ "$MODE" = "direct" ]; then
  echo "API 地址  : http://${IP}:8080/api"
  echo "LiveKit   : ws://${IP}:7880  (媒体 UDP 50000-50200 / TCP 7881)"
  echo "健康检查  : http://${IP}:8080/api/healthz"
  echo "=========================================="
  echo "重要: 云控制台 → 防火墙 放行:"
  echo "  TCP 8080,7880,7881  以及  UDP 50000-50200"
else
  echo "API 地址  : https://${DOMAIN}/api"
  echo "LiveKit   : wss://${DOMAIN}  (信令走 /rtc)"
  echo "健康检查  : https://${DOMAIN}/healthz"
  echo "=========================================="
  echo "重要: 云控制台 → 防火墙 放行:"
  echo "  TCP 80,443,7880,7881  以及  UDP 50000-50200"
fi
echo ""
echo "可选: 字幕服务  docker compose --profile subtitles up -d"
echo "       (需要 4G+ 内存，首次会下载 Whisper 模型)"
