#!/usr/bin/env bash
# =============================================================
# ScreenShare 服务器一键部署（腾讯云/阿里云轻量 · 香港 · Ubuntu 22.04）
# 部署: LiveKit(SFU) + Node API(房间/邀请码/JWT) + Caddy(HTTPS)
# 用法: bash setup.sh [公网IP]
# =============================================================
set -euo pipefail

IP="${1:-$(curl -s4 --max-time 5 ifconfig.me || true)}"
if [ -z "$IP" ]; then
  echo "错误: 无法自动获取公网 IP，请手动指定: bash setup.sh <公网IP>" >&2
  exit 1
fi
DOMAIN="screenshare.${IP}.sslip.io"
echo "==> 公网 IP : ${IP}"
echo "==> 域名    : https://${DOMAIN}  (sslip.io 免费动态域名，无需备案)"

# ---------- 0. 确保 swap（2G 内存机器防 OOM 死机） ----------
if ! swapon --show 2>/dev/null | grep -q swapfile; then
  echo "==> 创建 2G swap 内存保险..."
  fallocate -l 2G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q swapfile /etc/fstab 2>/dev/null || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# ---------- 1. 安装 Docker ----------
if ! command -v docker >/dev/null 2>&1; then
  echo "==> 安装 Docker..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker 2>/dev/null || true
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "==> 安装 docker compose 插件..."
  apt-get update -qq && apt-get install -y docker-compose-plugin
fi

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
cat > .env <<EOF
DOMAIN=${DOMAIN}
LIVEKIT_URL=wss://${DOMAIN}
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
echo "==> 预拉取 caddy 镜像..."
docker pull caddy:2

# ---------- 7. 启动 ----------
echo "==> 构建并启动服务（首次约 2-5 分钟）..."
docker compose up -d --build

echo ""
echo "================ 部署完成 ================"
echo "API 地址  : https://${DOMAIN}/api"
echo "LiveKit   : wss://${DOMAIN}  (信令走 /rtc)"
echo "健康检查  : https://${DOMAIN}/healthz"
echo "=========================================="
echo "重要: 腾讯云控制台 → 防火墙 放行:"
echo "  TCP 80,443,7880,7881  以及  UDP 50000-60000"
echo ""
echo "可选: 字幕服务  docker compose --profile subtitles up -d"
echo "       (需要 4G+ 内存，首次会下载 Whisper 模型)"
