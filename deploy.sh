#!/bin/bash
set -e

echo "=== Weight Bot Deploy Script ==="

cd ~/weight-bot

echo "[1/6] Pulling latest code..."
git pull

echo "[2/6] Checking config..."
if [ ! -f config.json ]; then
    echo "  config.json not found, creating default (meal_tracking OFF)..."
    cp config.json.example config.json 2>/dev/null || echo '{"features":{"meal_tracking":false,"image_recognition":false}}' > config.json
fi
echo "  Current config:"
cat config.json
echo ""

echo "[3/6] Installing Python dependencies..."
source venv/bin/activate
pip install -q -r requirements.txt

echo "[4/6] Updating OpenClaw plugin..."
cp plugin/* ~/weight-tools-plugin/
cp config.json ~/weight-tools-plugin/
cd ~/weight-tools-plugin
npm install --silent
openclaw plugins install -l ~/weight-tools-plugin

echo "[5/6] Restarting FastAPI service..."
cd ~/weight-bot
systemctl restart weight-bot

echo "[6/6] Restarting OpenClaw Gateway..."
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
