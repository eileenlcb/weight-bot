# Weight Bot

基于 OpenClaw + 微信的体重和饮食记录助手。

它的流程很简单：微信消息进入 OpenClaw，OpenClaw 调用本项目提供的工具插件，插件再把数据写入 FastAPI 后端，最后存到 SQLite。

## 功能

- 记录体重
- 查询最近一次体重
- 统计一段时间内的体重变化
- 记录饮食和估算热量
- 查询当天热量摄入
- 统计多日饮食数据
- 可选：食物图片识别

## 架构

```text
微信
  ↓
@tencent-weixin/openclaw-weixin
  ↓
OpenClaw Gateway
  ↓
weight-tools-plugin
  ↓ HTTP POST
FastAPI
  ↓
SQLite
```

## 目录

```text
weight-bot/
├── app.py                   # FastAPI 后端
├── config.json              # 功能开关
├── deploy.sh                # 更新部署脚本
├── plugin/
│   ├── index.ts             # OpenClaw 工具插件
│   ├── package.json
│   └── openclaw.plugin.json
├── requirements.txt
└── README.md
```

## 首次安装

下面默认服务器目录是 `~/weight-bot`，运行用户是 `root`。如果你不是 root，systemd 文件里的路径和用户要跟着改。

### 1. 安装系统依赖

```bash
apt update
apt install -y git curl nodejs npm python3 python3-venv sqlite3
```

小内存机器建议先加 swap。2G 内存跑文字记录够用，开启图片识别建议 4G 以上。

### 2. 安装 OpenClaw

```bash
curl -fsSL https://openclaw.ai/install.sh | bash
```

安装时建议选择：

- Provider: `Qwen Cloud`
- Auth: `Standard API Key`
- Model: `Qwen 3.5 Plus`

启动 Gateway：

```bash
sudo loginctl enable-linger $(whoami)
export XDG_RUNTIME_DIR=/run/user/$(id -u)

openclaw gateway install
openclaw gateway status
```

确认输出里有：

```text
Runtime: running
RPC probe: ok
```

### 3. 连接微信

```bash
export NODE_OPTIONS="--max-old-space-size=512"
npx -y @tencent-weixin/openclaw-weixin-cli@latest install
```

终端里会出现二维码，用微信扫码授权。

### 4. 部署 FastAPI 后端

```bash
cd ~
git clone https://github.com/eileenlcb/weight-bot.git
cd ~/weight-bot

python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

先手动跑一次：

```bash
uvicorn app:app --host 0.0.0.0 --port 8000
```

访问：

```text
http://<服务器 IP>:8000
```

正常会返回：

```json
{"ok": true, "message": "Weight Bot API is running"}
```

确认没问题后，按 `Ctrl+C` 停掉，改用 systemd 常驻运行：

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

### 5. 安装 OpenClaw 工具插件

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

`inspect` 里能看到 `weight-tools` 和工具列表就算成功。

### 6. 配置 Agent 提示词

可以用这段作为 OpenClaw 的系统提示词，让它更稳定地调用工具：

```bash
openclaw config set agent.systemPrompt "$(cat <<'EOF'
你是体重和饮食记录助手。

用户报体重时，调用 add_weight 记录。
用户问最近体重时，调用 get_latest_weight。
用户问体重趋势或统计时，调用 get_weight_stats。

用户描述吃了什么时，估算热量和营养数据，调用 add_meal_record。
用户问今天吃了多少、最近饮食统计时，调用 get_daily_calories 或 get_meal_stats。

回复要简洁，先告诉用户记录或查询结果。
EOF
)"

openclaw gateway restart
```

## 配置

`config.json` 控制功能开关：

```json
{
  "features": {
    "meal_tracking": true,
    "image_recognition": true
  }
}
```

| 配置 | 作用 | 建议 |
| --- | --- | --- |
| `meal_tracking` | 饮食记录和热量统计 | 一般保持 `true` |
| `image_recognition` | 食物图片识别 | 小内存机器改成 `false` |

改完 `config.json` 后，需要把它同步到插件目录，并重启 OpenClaw Gateway。最省事的方式是跑：

```bash
cd ~/weight-bot
bash deploy.sh
```

## 更新部署

代码更新后，推荐直接跑：

```bash
cd ~/weight-bot
bash deploy.sh
```

脚本会做这些事：

- 拉取 `origin/main`
- 安装 Python 依赖
- 重建 `~/weight-tools-plugin`
- 重新安装 OpenClaw 工具插件
- 重启 `weight-bot` FastAPI 服务
- 重启 OpenClaw Gateway
- 测试后端 API

如果想手动执行，用这组命令：

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

检查点：

- `openclaw plugins inspect weight-tools` 里版本是最新的
- `source` 指向 `~/weight-tools-plugin`
- 微信或 TUI 里重新发一句测试消息

如果只是改了 `app.py`，可以只执行：

```bash
cd ~/weight-bot
git pull --ff-only origin main
source venv/bin/activate
pip install -r requirements.txt
systemctl restart weight-bot
```

如果只是改了 `plugin/index.ts` 或 `config.json`，需要重新安装插件并重启 Gateway。

## 测试

### API

```bash
curl -s http://localhost:8000/ | python3 -m json.tool
```

记录体重：

```bash
curl -X POST http://localhost:8000/tool/add_weight \
  -H "Content-Type: application/json" \
  -d '{"user_id":"test","weight":68.5,"source_text":"manual test"}'
```

查询最近体重：

```bash
curl -X POST http://localhost:8000/tool/get_latest_weight \
  -H "Content-Type: application/json" \
  -d '{"user_id":"test"}'
```

### 微信

发送：

```text
记录我的体重 68.5kg
```

或者：

```text
最近一周体重统计
```

## 查看数据库

```bash
sqlite3 ~/weight-bot/weight.db
```

常用查询：

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

退出：

```sql
.quit
```

也可以一行查：

```bash
sqlite3 -header -column ~/weight-bot/weight.db \
'SELECT id, user_id, recorded_at, weight, unit, source_text, created_at FROM weight_records ORDER BY id DESC LIMIT 20;'
```

## 常见问题

| 问题 | 处理 |
| --- | --- |
| FastAPI 起不来 | 看端口是否被占用：`lsof -i :8000` |
| OpenClaw Gateway 不运行 | `openclaw gateway status`，必要时 `openclaw gateway restart` |
| 工具插件没更新 | 重新跑 `bash deploy.sh`，再看 `openclaw plugins inspect weight-tools` |
| `add_weight` 返回 body 不是对象 | 多半是旧插件还在跑，重新安装插件并重开 TUI session |
| TUI 正常，微信返回 `reasoning_content` 400 | 在微信会话里发送 `/reset`，再重试；也可以发送 `/new` |
| 图片无法识别 | 确认模型支持多模态，且 `image_recognition` 是 `true` |
| 服务器内存不够 | 关闭 `image_recognition`，或加 swap / 升级内存 |

## License

MIT
