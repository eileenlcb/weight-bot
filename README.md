# Weight Bot

A WeChat-based weight tracking and meal analysis assistant powered by [OpenClaw](https://openclaw.ai) and Qwen multimodal LLM.

## Prerequisites

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

## Installation

### 1. System dependencies

```bash
apt update && apt install -y git curl nodejs npm python3 python3-venv sqlite3
```

### 2. OpenClaw

```bash
curl -fsSL https://openclaw.ai/install.sh | bash
```

Select **Qwen Cloud** → **Standard API Key** → **Qwen 3.5 Plus** during setup.

### 3. Start Gateway

```bash
sudo loginctl enable-linger $(whoami)
export XDG_RUNTIME_DIR=/run/user/$(id -u)

openclaw gateway install
openclaw gateway status   # expect "Runtime: running" and "RPC probe: ok"
```

### 4. Connect WeChat

```bash
export NODE_OPTIONS="--max-old-space-size=512"
npx -y @tencent-weixin/openclaw-weixin-cli@latest install
```

Scan the QR code with WeChat.

### 5. Backend

```bash
cd ~
git clone https://github.com/eileenlcb/weight-bot.git
cd weight-bot

# quick test
uvicorn app:app --host 0.0.0.0 --port 8000
# GET http://<ip>:8000 → {"ok": true, ...}
```

### 6. Plugin

```bash
cp -r ~/weight-bot/plugin ~/weight-tools-plugin
cp ~/weight-bot/config.json ~/weight-tools-plugin/
cd ~/weight-tools-plugin && npm install

openclaw plugins install -l ~/weight-tools-plugin
openclaw gateway restart
```

Verify with `openclaw plugins inspect weight-tools`.

To update an existing local plugin install:

```bash
cd ~/weight-bot
git pull --ff-only origin main

rm -rf ~/weight-tools-plugin
cp -R ~/weight-bot/plugin ~/weight-tools-plugin
cp ~/weight-bot/config.json ~/weight-tools-plugin/config.json

cd ~/weight-tools-plugin
npm install

openclaw plugins uninstall weight-tools --keep-files || true
openclaw plugins install -l ~/weight-tools-plugin
openclaw gateway restart
openclaw plugins inspect weight-tools
```

## Troubleshooting

If TUI works but WeChat replies with:

```text
400 The reasoning_content in the thinking mode must be passed back to the API.
```

Send `/reset` in the WeChat chat, then try again. `/new` also starts a fresh session. Reinstall the WeChat plugin only if resetting the session does not help.

## Running as a systemd Service

```bash
cat > /etc/systemd/system/weight-bot.service << 'EOF'
[Unit]
Description=Weight Bot FastAPI Service
After=network.target

[Service]
User=root
WorkingDirectory=/root/weight-bot
Environment="PATH=/root/weight-bot/venv/bin"
ExecStart=/root/weight-bot/venv/bin/uvicorn app:app --host 0.0.0.0 --port 8000
Restart=always

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now weight-bot
```

## Configuration

Edit `config.json` in the project root:

```json
{
  "features": {
    "meal_tracking": true,
    "image_recognition": false
  }
}
```

| Key | Default | Notes |
|-----|---------|-------|
| `meal_tracking` | `false` | Text-based meal logging and calorie stats |
| `image_recognition` | `false` | Food photo recognition (requires 4 GB+ RAM) |

After changes, run `bash deploy.sh` to sync config and restart services.

## License

MIT
