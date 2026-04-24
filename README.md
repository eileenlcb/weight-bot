# Weight Bot

A WeChat-based weight and meal tracking assistant powered by OpenClaw, FastAPI, and SQLite.

Incoming WeChat messages are routed through OpenClaw. OpenClaw calls the local `weight-tools` plugin, the plugin forwards tool calls to the FastAPI backend, and the backend stores records in SQLite.

## Features

- Log weight records
- Query the latest weight
- Calculate weight stats and trends
- Log meals and estimated calories
- Query daily calorie intake
- Calculate multi-day meal stats
- Optional food image recognition

## Architecture

```text
WeChat
  |
@tencent-weixin/openclaw-weixin
  |
OpenClaw Gateway
  |
weight-tools-plugin
  |
FastAPI
  |
SQLite
```

## Repository Layout

```text
weight-bot/
├── app.py                   # FastAPI backend
├── config.json              # Feature flags
├── deploy.sh                # Update/deploy script
├── plugin/
│   ├── index.ts             # OpenClaw tool plugin
│   ├── package.json
│   └── openclaw.plugin.json
├── requirements.txt
└── README.md
```

## First-Time Installation

The commands below assume:

- The project lives at `~/weight-bot`
- The backend runs as `root`
- The backend service name is `weight-bot`

If you deploy under another user or path, update the systemd file accordingly.

### 1. Install System Packages

```bash
apt update
apt install -y git curl nodejs npm python3 python3-venv sqlite3
```

For small servers, add swap before enabling image recognition. Text-only tracking works on small machines; image recognition is better on 4 GB+ RAM.

### 2. Install OpenClaw

```bash
curl -fsSL https://openclaw.ai/install.sh | bash
```

Recommended setup choices:

- Provider: `Qwen Cloud`
- Auth: `Standard API Key`
- Model: `Qwen 3.5 Plus`

Install and start the Gateway:

```bash
sudo loginctl enable-linger $(whoami)
export XDG_RUNTIME_DIR=/run/user/$(id -u)

openclaw gateway install
openclaw gateway status
```

Expected status:

```text
Runtime: running
RPC probe: ok
```

### 3. Connect WeChat

```bash
export NODE_OPTIONS="--max-old-space-size=512"
npx -y @tencent-weixin/openclaw-weixin-cli@latest install
```

Scan the QR code in the terminal with WeChat.

### 4. Deploy the FastAPI Backend

```bash
cd ~
git clone https://github.com/eileenlcb/weight-bot.git
cd ~/weight-bot

python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

Run a quick manual check:

```bash
uvicorn app:app --host 0.0.0.0 --port 8000
```

Open:

```text
http://<server-ip>:8000
```

Expected response:

```json
{"ok": true, "message": "Weight Bot API is running"}
```

Stop the manual server with `Ctrl+C`, then create a systemd service:

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
systemctl status weight-bot
```

### 5. Install the OpenClaw Tool Plugin

```bash
rm -rf ~/weight-tools-plugin
cp -R ~/weight-bot/plugin ~/weight-tools-plugin
cp ~/weight-bot/config.json ~/weight-tools-plugin/config.json

cd ~/weight-tools-plugin
npm install

openclaw plugins install -l ~/weight-tools-plugin
openclaw gateway restart
openclaw plugins inspect weight-tools
```

`inspect` should show the `weight-tools` plugin and its registered tools.

### 6. Configure the Agent Prompt

OpenClaw 2026.4.x injects workspace bootstrap files such as `AGENTS.md` into each new session. Put the bot instructions there instead of setting `agent.systemPrompt`.

Put this block near the top of `AGENTS.md`. If the file is long and the block is appended at the bottom, it may be truncated before it reaches the model.

This prompt is intentionally Chinese because the WeChat bot is expected to talk to Chinese users.

```bash
WORKSPACE="$(openclaw config get agents.defaults.workspace | tail -n 1)"
WORKSPACE="${WORKSPACE/#\~/$HOME}"
mkdir -p "$WORKSPACE"

if [ -f "$WORKSPACE/AGENTS.md" ]; then
  cp "$WORKSPACE/AGENTS.md" "$WORKSPACE/AGENTS.md.bak.$(date +%Y%m%d%H%M%S)"
fi

cat > /tmp/weight-bot-agents.md <<'EOF'

## 王大娇体重助手

你是"王大娇体重助手"，一个专业的体重管理和饮食分析助手。

【核心能力】
1. 体重记录：用户报体重时，调用 add_weight 记录
2. 体重查询：调用 get_latest_weight 或 get_weight_stats
3. 饮食分析：用户发送食物图片或描述吃了什么时，你需要：
   - 识别图片中的所有食物
   - 估算每种食物的份量和卡路里
   - 计算总热量、蛋白质、脂肪、碳水
   - 给出营养建议和减肥提醒
   - 调用 add_meal_record 记录本餐
4. 饮食统计：调用 get_daily_calories 或 get_meal_stats

【饮食分析规则】
- 收到食物图片时，仔细观察图片内容，列出每种食物
- 根据目测份量估算克重，再按常见营养数据计算卡路里
- meal_type 根据时间自动判断：早餐(6-10点)、午餐(11-14点)、晚餐(17-21点)、加餐(其他)
- advice 字段要结合用户体重目标给出实用建议
- 提醒时保持鼓励和积极的语气

【回复风格】
- 简洁、亲切、有活力
- 适当使用 emoji
- 体重和饮食数据要准确展示
EOF

if [ -f "$WORKSPACE/AGENTS.md" ]; then
  cat /tmp/weight-bot-agents.md "$WORKSPACE/AGENTS.md" > "$WORKSPACE/AGENTS.md.new"
  mv "$WORKSPACE/AGENTS.md.new" "$WORKSPACE/AGENTS.md"
else
  mv /tmp/weight-bot-agents.md "$WORKSPACE/AGENTS.md"
fi

openclaw gateway restart
```

After changing `AGENTS.md`, send `/reset` or `/new` in WeChat so the next message starts with the updated instructions.

## Configuration

`config.json` controls feature flags:

```json
{
  "features": {
    "meal_tracking": true,
    "image_recognition": true
  }
}
```

| Key | Description | Recommendation |
| --- | --- | --- |
| `meal_tracking` | Meal logging and calorie stats | Usually keep `true` |
| `image_recognition` | Food image recognition | Set to `false` on small servers |

After changing `config.json`, sync it into the plugin directory and restart OpenClaw Gateway. The easiest way is:

```bash
cd ~/weight-bot
bash deploy.sh
```

## Updating After Code Changes

For normal updates, run:

```bash
cd ~/weight-bot
bash deploy.sh
```

The script will:

- Pull `origin/main`
- Install Python dependencies
- Rebuild `~/weight-tools-plugin`
- Reinstall the OpenClaw tool plugin
- Restart the `weight-bot` FastAPI service
- Restart OpenClaw Gateway
- Test the backend API

Manual update steps:

```bash
cd ~/weight-bot
git pull --ff-only origin main

source venv/bin/activate
pip install -r requirements.txt
systemctl restart weight-bot

rm -rf ~/weight-tools-plugin
cp -R ~/weight-bot/plugin ~/weight-tools-plugin
cp ~/weight-bot/config.json ~/weight-tools-plugin/config.json

cd ~/weight-tools-plugin
npm install

openclaw plugins uninstall weight-tools --keep-files || true
openclaw plugins install -l ~/weight-tools-plugin
openclaw gateway restart

openclaw plugins list --enabled --verbose
openclaw plugins inspect weight-tools
```

Check these after updating:

- `openclaw plugins inspect weight-tools` shows the latest plugin version
- The plugin source points to `~/weight-tools-plugin`
- A fresh test message works in WeChat or OpenClaw TUI

If only `app.py` changed:

```bash
cd ~/weight-bot
git pull --ff-only origin main
source venv/bin/activate
pip install -r requirements.txt
systemctl restart weight-bot
```

If `plugin/index.ts` or `config.json` changed, reinstall the plugin and restart OpenClaw Gateway.

## Testing

### API

```bash
curl -s http://localhost:8000/ | python3 -m json.tool
```

Log a weight record:

```bash
curl -X POST http://localhost:8000/tool/add_weight \
  -H "Content-Type: application/json" \
  -d '{"user_id":"test","weight":68.5,"source_text":"manual test"}'
```

Query the latest weight:

```bash
curl -X POST http://localhost:8000/tool/get_latest_weight \
  -H "Content-Type: application/json" \
  -d '{"user_id":"test"}'
```

### WeChat

Send:

```text
记录我的体重 68.5kg
```

Or:

```text
最近一周体重统计
```

## Inspecting the Database

```bash
sqlite3 ~/weight-bot/weight.db
```

Common queries:

```sql
.headers on
.mode column

SELECT id, user_id, recorded_at, weight, unit, source_text, created_at
FROM weight_records
ORDER BY id DESC
LIMIT 20;

SELECT id, user_id, meal_type, estimated_calories, recorded_at
FROM meal_records
ORDER BY id DESC
LIMIT 20;
```

Exit:

```sql
.quit
```

One-line query:

```bash
sqlite3 -header -column ~/weight-bot/weight.db \
'SELECT id, user_id, recorded_at, weight, unit, source_text, created_at FROM weight_records ORDER BY id DESC LIMIT 20;'
```

## Troubleshooting

| Issue | Fix |
| --- | --- |
| FastAPI does not start | Check whether port 8000 is occupied: `lsof -i :8000` |
| OpenClaw Gateway is not running | Run `openclaw gateway status`, then `openclaw gateway restart` |
| Tool plugin did not update | Run `bash deploy.sh`, then inspect with `openclaw plugins inspect weight-tools` |
| `add_weight` says the request body is not an object | The old plugin is probably still loaded. Reinstall the plugin and start a fresh TUI session |
| TUI works, but WeChat returns `reasoning_content` 400 | Send `/reset` in the WeChat chat and retry. `/new` also starts a fresh session |
| Image recognition does not work | Confirm the model supports multimodal input and `image_recognition` is `true` |
| Server memory is too small | Disable `image_recognition`, add swap, or upgrade RAM |

## License

MIT
