#!/bin/bash
set -e

echo "=== Weight Bot Deploy Script ==="

cd ~/weight-bot

echo "[1/5] Pulling latest code..."
git pull

echo "[2/5] Installing Python dependencies..."
source venv/bin/activate
pip install -q -r requirements.txt

echo "[3/5] Updating OpenClaw plugin..."
cp plugin/* ~/weight-tools-plugin/
cd ~/weight-tools-plugin
npm install --silent
openclaw plugins install -l ~/weight-tools-plugin

echo "[4/5] Restarting FastAPI service..."
cd ~/weight-bot
systemctl restart weight-bot

echo "[5/5] Restarting OpenClaw Gateway..."
openclaw gateway restart

echo ""
echo "=== Deploy complete! ==="
echo "FastAPI status:"
systemctl is-active weight-bot
echo ""
echo "Testing API..."
curl -s http://localhost:8000/ | python3 -m json.tool
echo ""
echo "Done! You can now test in WeChat."
