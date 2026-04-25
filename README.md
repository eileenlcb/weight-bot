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

OpenClaw 2026.4.2 may expose Qwen/DashScope models under the provider id `modelstudio` instead of `qwen`. If `openclaw models list --all --provider qwen` returns no models, check `modelstudio`:

```bash
openclaw models list --all --provider modelstudio
```

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

### 2.1. Configure Text and Image Models

This bot works best with a fast text model for normal chat/tool calls and a multimodal model for food images.

Recommended routing:

```text
Text/tool model : deepseek/deepseek-v4-flash
Image model     : modelstudio/qwen3.5-plus
```

Verify DeepSeek:

```bash
openclaw models list --all --provider deepseek
```

If DeepSeek is not configured yet, add its API key first:

```bash
openclaw onboard --auth-choice deepseek-api-key
```

Verify Qwen/DashScope through `modelstudio`:

```bash
openclaw models list --all --provider modelstudio
openclaw models status --probe --probe-provider modelstudio
```

`modelstudio/qwen3.5-plus` should show `text+image` in the `Input` column and probe as `ok`.

Set the models:

```bash
openclaw models set deepseek/deepseek-v4-flash
openclaw models set-image modelstudio/qwen3.5-plus
openclaw gateway restart
openclaw models status
```

Expected status:

```text
Default     : deepseek/deepseek-v4-flash
Image model : modelstudio/qwen3.5-plus
```

Disable DeepSeek thinking mode for this bot. It avoids `reasoning_content` API errors and prevents reasoning text from leaking into WeChat replies.

```bash
openclaw config set agents.defaults.thinkingDefault off
openclaw gateway restart
```

For `deepseek-v4-flash`, also set a per-model disabled thinking payload:

```bash
CFG="$HOME/.openclaw/openclaw.json"
cp "$CFG" "$CFG.bak.$(date +%Y%m%d%H%M%S)"

jq '
  .agents.defaults.thinkingDefault = "off"
  | .agents.defaults.models["deepseek/deepseek-v4-flash"].params.thinking = {"type":"disabled"}
' "$CFG" > /tmp/openclaw.json && mv /tmp/openclaw.json "$CFG"

openclaw gateway restart
```

Then reset each WeChat session once:

```text
/reasoning:off
/think:off
/reset
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

`inspect` should show the `weight-tools` plugin and its registered tools. Version `2.1.1` and newer automatically injects the current WeChat peer id into backend `user_id`; the model no longer sees or controls `user_id`.

### 6. Enable Multi-User WeChat Sessions

If more than one person uses the same WeChat bot, isolate direct-message sessions by sender:

```bash
openclaw config set session.dmScope per-account-channel-peer
openclaw gateway restart
```

When another WeChat user messages the bot for the first time, approve the pairing request:

```bash
openclaw pairing list openclaw-weixin
openclaw pairing approve openclaw-weixin <CODE> --notify
```

The backend still uses one shared SQLite database, but records are separated by the WeChat peer id:

```text
o9cq808X9lejkB_0Kgc04rbthyXo@im.wechat
```

Do not use `sessionId` for business data. `/new` and `/reset` create a new `sessionId`, while the trusted sender id remains tied to the WeChat user.

### 7. Configure the Agent Prompt

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
- 工具会自动绑定当前微信用户，不要编造或询问 user_id
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

openclaw plugins uninstall weight-tools || true
rm -rf ~/.openclaw/extensions/weight-tools
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

Direct API calls still require `user_id`. OpenClaw tool calls inject it automatically from the current sender.

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

### OpenClaw Model Routing

Check the active model setup:

```bash
openclaw models status
```

For the current recommended setup, the important lines are:

```text
Default     : deepseek/deepseek-v4-flash
Image model : modelstudio/qwen3.5-plus
```

To confirm whether a model can read images, inspect the `Input` column:

```bash
openclaw models list --all --provider modelstudio
```

Only models with `image` or `text+image` can inspect uploaded pictures. Text-only models such as `deepseek/deepseek-v4-flash` cannot see food images directly.

If `qwen` shows no models:

```bash
openclaw models list --all --provider qwen
```

but `modelstudio` shows Qwen models:

```bash
openclaw models list --all --provider modelstudio
```

use `modelstudio/qwen3.5-plus` as the image model. On OpenClaw 2026.4.2, Qwen/DashScope may be exposed through `modelstudio`.

### Confirming Image Requests Use Qwen

The config-level check is:

```bash
openclaw models status
```

If it shows `Image model : modelstudio/qwen3.5-plus`, image messages should route there.

If `openclaw logs --follow` fails with `pairing required`, read the local log file or systemd logs instead:

```bash
tail -f /tmp/openclaw/openclaw-$(date +%F).log | grep -Ei 'modelstudio|qwen3\.5|image|provider|model'
```

or:

```bash
journalctl -u openclaw-gateway.service -f | grep -Ei 'modelstudio|qwen3\.5|image|provider|model'
```

Then send a food image from WeChat and look for `modelstudio/qwen3.5-plus`.

### `reasoning_content` 400 with DeepSeek V4 Flash

Error:

```text
400 The `reasoning_content` in the thinking mode must be passed back to the API.
```

This is usually a DeepSeek thinking-mode compatibility issue, not a Weight Bot API problem. It can happen after a tool call or on the next message in the same session.

Disable thinking globally:

```bash
openclaw config set agents.defaults.thinkingDefault off
openclaw gateway restart
```

Also force `deepseek-v4-flash` to send `thinking: disabled`:

```bash
CFG="$HOME/.openclaw/openclaw.json"
cp "$CFG" "$CFG.bak.$(date +%Y%m%d%H%M%S)"

jq '
  .agents.defaults.thinkingDefault = "off"
  | .agents.defaults.models["deepseek/deepseek-v4-flash"].params.thinking = {"type":"disabled"}
' "$CFG" > /tmp/openclaw.json && mv /tmp/openclaw.json "$CFG"

openclaw gateway restart
```

Then reset the WeChat session:

```text
/think:off
/reset
```

Check the session state:

```text
/think
```

Expected:

```text
Current thinking level: off.
```

### `Reasoning:` Appears in WeChat Replies

If WeChat shows a block like this:

```text
Reasoning:
The user is asking...
```

there are two possible causes.

If OpenClaw is intentionally showing reasoning, turn it off in the WeChat session:

```text
/reasoning:off
/reset
```

Check:

```text
/reasoning
```

Expected:

```text
Current reasoning level: off.
```

OpenClaw 2026.4.2 does not accept `agents.defaults.reasoningDefault` in `openclaw.json`. Do not add this field. If it was added by mistake, remove it:

```bash
CFG="$HOME/.openclaw/openclaw.json"

jq 'del(.agents.defaults.reasoningDefault)' "$CFG" > /tmp/openclaw.json \
  && mv /tmp/openclaw.json "$CFG"

openclaw gateway restart
```

If `/reasoning` and `/think` both say `off`, but replies still contain `Reasoning:`, the model is likely putting reasoning text into normal message content. Keep the per-model `thinking: disabled` config above. If it still happens, switch the text model to the non-thinking DeepSeek surface:

```bash
openclaw models set deepseek/deepseek-chat
openclaw models set-image modelstudio/qwen3.5-plus
openclaw gateway restart
```

### OpenClaw 2026.4.2 CLI Differences

Some docs mention `openclaw config set ... --merge`, but OpenClaw 2026.4.2 may not support `--merge`.

Instead, edit `~/.openclaw/openclaw.json` with `jq`, keep a backup, and restart Gateway:

```bash
CFG="$HOME/.openclaw/openclaw.json"
cp "$CFG" "$CFG.bak.$(date +%Y%m%d%H%M%S)"

jq '<filter here>' "$CFG" > /tmp/openclaw.json && mv /tmp/openclaw.json "$CFG"
openclaw gateway restart
```

If Gateway refuses to start, validate the config error first:

```bash
openclaw gateway restart
openclaw doctor
```

Common example:

```text
agents.defaults: Unrecognized key: "reasoningDefault"
```

Remove the bad key and restart.

### Quick Reference

| Issue | Fix |
| --- | --- |
| FastAPI does not start | Check whether port 8000 is occupied: `lsof -i :8000` |
| OpenClaw Gateway is not running | Run `openclaw gateway status`, then `openclaw gateway restart` |
| Tool plugin did not update | Run `bash deploy.sh`, then inspect with `openclaw plugins inspect weight-tools` |
| `add_weight` says the request body is not an object | The old plugin is probably still loaded. Reinstall the plugin and start a fresh TUI session |
| TUI works, but WeChat returns `reasoning_content` 400 | Disable thinking, restart Gateway, then send `/think:off` and `/reset` in WeChat |
| WeChat replies include `Reasoning:` | Send `/reasoning:off`, `/think:off`, and `/reset`; if it continues, switch text model to `deepseek/deepseek-chat` |
| Image recognition does not work | Confirm the image model has `text+image` input and `image_recognition` is `true` |
| Server memory is too small | Disable `image_recognition`, add swap, or upgrade RAM |

## License

MIT
