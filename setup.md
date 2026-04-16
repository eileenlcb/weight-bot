# 微信智能体重 & 饮食助手 — 部署指南

## 架构总览

```
微信用户
  ↓ (文字/图片消息)
@tencent-weixin/openclaw-weixin (微信渠道插件)
  ↓
OpenClaw Gateway (AI Agent + Qwen 3.5 Plus 多模态)
  ↓ (工具调用)
weight-tools-plugin (Node 插件，注册工具)
  ↓ (HTTP POST)
FastAPI (Python 后端，数据处理)
  ↓
SQLite (持久化存储)
```

**功能清单：**
- 体重记录 / 查询 / 趋势统计（默认开启）
- 餐食图片识别 → 卡路里估算 → 营养建议（可配置，默认关闭）
- 每日 / 多日饮食统计（可配置，默认关闭）

> 饮食相关功能需要多模态图片处理，建议 4G 以上内存的服务器开启。
> 通过 `config.json` 控制功能开关，无需改代码。

---

## 一、服务器环境准备

### 1. 基础软件

```bash
apt update && apt install -y git curl nodejs npm python3 python3-venv sqlite3
```

### 2. Swap（2G 内存以下的服务器必须加）

```bash
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

---

## 二、安装 OpenClaw

```bash
curl -fsSL https://openclaw.ai/install.sh | bash
```

安装时选择：
- Provider: **Qwen Cloud**
- Auth: **Standard API Key**（不要选 Coding Plan）
- Model: **Qwen 3.5 Plus**（支持多模态图片识别）

---

## 三、启动 Gateway

```bash
sudo loginctl enable-linger $(whoami)
export XDG_RUNTIME_DIR=/run/user/$(id -u)

openclaw gateway install
openclaw gateway status
```

确认输出包含：
```
Runtime: running
RPC probe: ok
```

---

## 四、接入微信

```bash
export NODE_OPTIONS="--max-old-space-size=512"
npx -y @tencent-weixin/openclaw-weixin-cli@latest install
```

用微信扫描终端中的二维码完成绑定。

---

## 五、部署 FastAPI 后端

### 1. 拉取代码

```bash
cd ~
git clone https://github.com/eileenlcb/weight-bot.git
cd ~/weight-bot
```

如果已有旧代码，先备份 weight.db 再拉取：
```bash
cp ~/weight-bot/weight.db ~/weight.db.bak
cd ~/weight-bot && git pull
```

### 2. 创建虚拟环境 & 安装依赖

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### 3. 测试启动

```bash
cd ~/weight-bot
uvicorn app:app --host 0.0.0.0 --port 8000
```

访问 `http://<服务器IP>:8000` 应返回 `{"ok": true, "message": "Weight Bot API is running"}`。

### 4. 配置 systemd 持久化运行

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
systemctl enable weight-bot
systemctl start weight-bot
systemctl status weight-bot
```

---

## 六、安装 OpenClaw 工具插件

### 1. 部署插件文件

```bash
cp -r ~/weight-bot/plugin ~/weight-tools-plugin
cp ~/weight-bot/config.json ~/weight-tools-plugin/
cd ~/weight-tools-plugin
npm install
```

### 2. 注册插件到 OpenClaw

```bash
openclaw plugins install -l ~/weight-tools-plugin
```

### 3. 验证插件

```bash
openclaw plugins inspect weight-tools
```

默认注册 3 个体重工具。开启 `meal_tracking` 后会注册 6 个工具。

### 4. 重启 Gateway 使插件生效

```bash
openclaw gateway restart
```

---

## 七、功能配置（config.json）

项目根目录的 `config.json` 控制功能开关：

```json
{
  "features": {
    "meal_tracking": true,
    "image_recognition": false
  }
}
```

| 配置项 | 说明 | 默认 | 要求 |
|--------|------|------|------|
| `meal_tracking` | 饮食记录 + 卡路里统计（文字描述） | `true` | 无特殊要求 |
| `image_recognition` | 食物图片自动识别 | `false` | 需要多模态模型 + 4G+ 内存 |

- `meal_tracking: true` + `image_recognition: false`：用户可以用文字描述吃了什么，LLM 估算卡路里（2G 服务器可用）
- `meal_tracking: true` + `image_recognition: true`：用户可以直接发食物照片，LLM 自动识别（需要 4G+ 内存）

**开启方法：** 修改 `config.json` 后，重新执行 `bash deploy.sh` 即可。

**注意：** 修改 config.json 后需要同时同步到插件目录并重启 Gateway，`deploy.sh` 会自动处理。

---

## 八、配置 AI Agent 人设（System Prompt）

通过 OpenClaw 配置 Agent 的系统提示词，让 AI 知道如何处理图片和饮食记录：

```bash
openclaw config set agent.systemPrompt "$(cat <<'EOF'
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
)"
```

---

## 九、测试验证

### 体重功能测试

在微信中发送：
```
今天 55.1
```

### 饮食识别测试

在微信中发送一张食物照片，助手应自动识别食物并估算卡路里。

### 饮食统计测试

在微信中发送：
```
今天吃了多少卡路里
最近一周饮食统计
```

### API 直接测试

```bash
# 记录饮食
curl -X POST http://localhost:8000/tool/add_meal_record \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "test",
    "meal_type": "dinner",
    "food_items": [
      {"name": "牛肉", "amount": "120g", "calories": 250},
      {"name": "鸡蛋", "amount": "1个", "calories": 78}
    ],
    "estimated_calories": 328,
    "protein_g": 42,
    "fat_g": 18,
    "carb_g": 1,
    "image_description": "120克牛肉和一个水煮蛋",
    "advice": "蛋白质充足，建议搭配一些蔬菜补充膳食纤维"
  }'

# 查看今日摄入
curl -X POST http://localhost:8000/tool/get_daily_calories \
  -H "Content-Type: application/json" \
  -d '{"user_id": "test"}'
```

---

## 十、查看数据库

```bash
sqlite3 ~/weight-bot/weight.db
```

```sql
-- 体重记录
SELECT * FROM weight_records ORDER BY recorded_at DESC LIMIT 10;

-- 饮食记录
SELECT * FROM meal_records ORDER BY recorded_at DESC LIMIT 10;

-- 今日总热量
SELECT SUM(estimated_calories) FROM meal_records
WHERE recorded_at >= date('now');
```

---

## 十一、常见问题

| 问题 | 解决方案 |
|------|---------|
| 服务器卡死 | 没加 swap → 加 swap 后重启 |
| 401 错误 | API Key 选错了 → 用 Standard Key |
| 插件报错 | 检查 `openclaw.plugin.json` 是否有 `"id"` 字段 |
| Gateway 不运行 | `openclaw gateway status` 检查，`openclaw gateway restart` 重启 |
| 图片无法识别 | 确认 Qwen 3.5 Plus 模型已配置且支持多模态 |
| FastAPI 启动失败 | 检查端口 8000 是否被占用：`lsof -i :8000` |
| 饮食记录不生效 | 重启 Gateway：`openclaw gateway restart` |

---

## 项目文件结构

```
weight-bot/
├── app.py                   # FastAPI 后端（体重 + 饮食 API）
├── config.json              # 功能开关配置
├── deploy.sh                # 一键部署脚本
├── plugin/
│   ├── index.ts             # OpenClaw 工具插件（根据 config 动态注册）
│   ├── package.json         # 插件依赖
│   └── openclaw.plugin.json # 插件元数据
├── requirements.txt         # Python 依赖
├── .gitignore               # Git 忽略规则
└── setup.md                 # 本部署文档
```
