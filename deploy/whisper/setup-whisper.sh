#!/usr/bin/env bash
# 一键搭建 whisper.cpp 常驻推理服务（Ubuntu / Debian）
# 用法：chmod +x deploy/whisper/setup-whisper.sh && sudo ./deploy/whisper/setup-whisper.sh
set -euo pipefail

MODEL="${WHISPER_MODEL:-ggml-base-q5_0.bin}"
MODEL_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${MODEL}"
INSTALL_DIR="${WHISPER_INSTALL_DIR:-/opt/whisper.cpp}"

echo "[1/4] 安装编译依赖（cmake / ffmpeg）"
apt-get update
apt-get install -y cmake gcc g++ git ffmpeg

echo "[2/4] 克隆并编译 whisper.cpp"
if [ ! -d "${INSTALL_DIR}" ]; then
  git clone --depth 1 https://github.com/ggerganov/whisper.cpp.git "${INSTALL_DIR}"
fi
cd "${INSTALL_DIR}"
cmake -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build -j2

echo "[3/4] 下载模型 ${MODEL}"
mkdir -p "${INSTALL_DIR}/models"
if [ ! -f "${INSTALL_DIR}/models/${MODEL}" ]; then
  curl -L --fail -o "${INSTALL_DIR}/models/${MODEL}" "${MODEL_URL}"
fi

echo "[4/4] 安装 systemd 服务"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_SRC="${SCRIPT_DIR}/../systemd/whisper-asr.service"
if [ -f "${SERVICE_SRC}" ]; then
  cp "${SERVICE_SRC}" /etc/systemd/system/whisper-asr.service
  systemctl daemon-reload
  systemctl enable --now whisper-asr
  systemctl status whisper-asr --no-pager || true
else
  echo "未找到 ${SERVICE_SRC}，请手动安装 whisper-asr.service"
fi

echo "完成：whisper 服务监听 127.0.0.1:9000（模型 ${MODEL}）"
