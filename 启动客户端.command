#!/bin/bash
# ScreenShare 客户端一键启动（双击运行）
cd "$(dirname "$0")/apps/desktop"
export PATH="/Users/wwj/.workbuddy/binaries/node/versions/22.22.2/bin:$PATH"
npm run dev
