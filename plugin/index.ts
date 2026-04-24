import type {
  OpenClawPluginApi,
  OpenClawPluginToolContext,
  AnyAgentTool,
} from "openclaw/plugin-sdk/plugin-entry";
import { Type } from "@sinclair/typebox";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const API_BASE = "http://127.0.0.1:8000";

function loadConfig(): Record<string, unknown> {
  const dir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(dir, "config.json"),
    resolve(dir, "..", "config.json"),
  ];
  for (const p of candidates) {
    try {
      return JSON.parse(readFileSync(p, "utf-8"));
    } catch {
      // try next
    }
  }
  return { features: { meal_tracking: false, image_recognition: false } };
}

function isFeatureEnabled(config: Record<string, unknown>, name: string): boolean {
  const features = config.features as Record<string, boolean> | undefined;
  return features?.[name] ?? false;
}

async function callApi(path: string, body: Record<string, unknown>) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return await res.json();
}

function cleanIdPart(value: unknown, fallback: string): string {
  const raw = typeof value === "string" && value.trim() ? value.trim() : fallback;
  const cleaned = raw.replace(/[^a-zA-Z0-9_.:@+-]/g, "_");
  return cleaned.slice(0, 160) || fallback;
}

function extractPeerIdFromSessionKey(sessionKey?: string): string | undefined {
  if (!sessionKey) {
    return undefined;
  }
  const match = sessionKey.match(/:direct:([^:]+)$/);
  return match?.[1];
}

function getContextUserId(ctx: OpenClawPluginToolContext): string {
  const channel = cleanIdPart(
    ctx.deliveryContext?.channel ?? ctx.messageChannel,
    "local"
  );
  const accountId = cleanIdPart(
    ctx.deliveryContext?.accountId ?? ctx.agentAccountId,
    "default"
  );

  if (ctx.requesterSenderId) {
    return `${channel}:${accountId}:${cleanIdPart(
      ctx.requesterSenderId,
      "sender"
    )}`;
  }

  const peerId = extractPeerIdFromSessionKey(ctx.sessionKey);
  if (peerId) {
    return cleanIdPart(peerId, "sender");
  }

  if (ctx.sessionKey) {
    return `${channel}:${accountId}:session:${cleanIdPart(
      ctx.sessionKey,
      "default"
    )}`;
  }

  return `${channel}:${accountId}:default`;
}

function withContextUser(
  params: Record<string, unknown> | undefined,
  ctx: OpenClawPluginToolContext
): Record<string, unknown> {
  return {
    ...(params ?? {}),
    user_id: getContextUserId(ctx),
  };
}

function createWeightTools(ctx: OpenClawPluginToolContext): AnyAgentTool[] {
  return [
    {
      name: "add_weight",
      description: "记录用户体重。当用户告诉你体重数据时调用此工具。",
      parameters: Type.Object({
        weight: Type.Number({ description: "体重数值，单位 kg" }),
        recorded_at: Type.Optional(
          Type.String({ description: "记录时间，ISO8601 格式；为空则用当前时间" })
        ),
        source_text: Type.Optional(
          Type.String({ description: "用户原始输入文本" })
        ),
      }),
      execute: async (_id: string, params: Record<string, unknown>) => {
        try {
          const result = await callApi(
            "/tool/add_weight",
            withContextUser(params, ctx)
          );
          return { result: "success", details: result };
        } catch (err) {
          return { result: "error", error: String(err) };
        }
      },
    },
    {
      name: "get_latest_weight",
      description: "获取用户最近一条体重记录。",
      parameters: Type.Object({}),
      execute: async (_id: string, params: Record<string, unknown>) => {
        try {
          const result = await callApi(
            "/tool/get_latest_weight",
            withContextUser(params, ctx)
          );
          return { result: "success", details: result };
        } catch (err) {
          return { result: "error", error: String(err) };
        }
      },
    },
    {
      name: "get_weight_stats",
      description:
        "获取用户一段时间内的体重统计（平均、最高、最低、变化趋势）。",
      parameters: Type.Object({
        days: Type.Optional(
          Type.Integer({ description: "统计最近多少天，1-365", default: 7 })
        ),
      }),
      execute: async (_id: string, params: Record<string, unknown>) => {
        try {
          const result = await callApi(
            "/tool/get_weight_stats",
            withContextUser(params, ctx)
          );
          return { result: "success", details: result };
        } catch (err) {
          return { result: "error", error: String(err) };
        }
      },
    },
  ];
}

function createMealTools(
  imageEnabled: boolean,
  ctx: OpenClawPluginToolContext
): AnyAgentTool[] {
  const addMealDesc = imageEnabled
    ? "记录用户的一餐饮食。当用户发送食物图片或描述吃了什么时，分析食物内容，估算卡路里和营养成分，然后调用此工具记录。"
    : "记录用户的一餐饮食。当用户用文字描述吃了什么时，根据描述估算卡路里和营养成分，然后调用此工具记录。注意：图片识别功能未开启，如果用户发送了食物图片，请提醒用户用文字描述食物内容和大致份量。";

  return [
    {
      name: "add_meal_record",
      description: addMealDesc,
      parameters: Type.Object({
        meal_type: Type.Optional(
          Type.String({
            description: "餐食类型: breakfast/lunch/dinner/snack/other",
            default: "other",
          })
        ),
        food_items: Type.Array(
          Type.Object({
            name: Type.String({ description: "食物名称" }),
            amount: Type.Optional(
              Type.String({ description: "份量描述，如 '100g', '1碗'" })
            ),
            calories: Type.Optional(
              Type.Number({ description: "该食物预估卡路里 (kcal)" })
            ),
          }),
          { description: "识别到的食物列表" }
        ),
        estimated_calories: Type.Number({
          description: "本餐预估总卡路里 (kcal)",
        }),
        protein_g: Type.Optional(
          Type.Number({ description: "预估蛋白质 (g)" })
        ),
        fat_g: Type.Optional(
          Type.Number({ description: "预估脂肪 (g)" })
        ),
        carb_g: Type.Optional(
          Type.Number({ description: "预估碳水化合物 (g)" })
        ),
        fiber_g: Type.Optional(
          Type.Number({ description: "预估膳食纤维 (g)" })
        ),
        image_description: Type.Optional(
          Type.String({ description: "图片中食物的文字描述" })
        ),
        advice: Type.Optional(
          Type.String({ description: "营养建议和减肥提醒" })
        ),
        recorded_at: Type.Optional(
          Type.String({ description: "记录时间，ISO8601 格式；为空则用当前时间" })
        ),
      }),
      execute: async (_id: string, params: Record<string, unknown>) => {
        try {
          const result = await callApi(
            "/tool/add_meal_record",
            withContextUser(params, ctx)
          );
          return { result: "success", details: result };
        } catch (err) {
          return { result: "error", error: String(err) };
        }
      },
    },
    {
      name: "get_daily_calories",
      description:
        "获取用户某天的饮食记录和总热量摄入。查看今天或指定日期吃了什么、摄入了多少卡路里。",
      parameters: Type.Object({
        date: Type.Optional(
          Type.String({ description: "查询日期 YYYY-MM-DD，为空则查今天" })
        ),
      }),
      execute: async (_id: string, params: Record<string, unknown>) => {
        try {
          const result = await callApi(
            "/tool/get_daily_calories",
            withContextUser(params, ctx)
          );
          return { result: "success", details: result };
        } catch (err) {
          return { result: "error", error: String(err) };
        }
      },
    },
    {
      name: "get_meal_stats",
      description:
        "获取用户一段时间内的饮食统计（每日平均卡路里、最高最低、每日明细）。",
      parameters: Type.Object({
        days: Type.Optional(
          Type.Integer({ description: "统计最近多少天，1-365", default: 7 })
        ),
      }),
      execute: async (_id: string, params: Record<string, unknown>) => {
        try {
          const result = await callApi(
            "/tool/get_meal_stats",
            withContextUser(params, ctx)
          );
          return { result: "success", details: result };
        } catch (err) {
          return { result: "error", error: String(err) };
        }
      },
    },
  ];
}

const plugin = {
  id: "weight-tools",
  name: "Weight Tools",
  description: "Weight tracking and meal calorie estimation tools",

  register(api: OpenClawPluginApi) {
    const config = loadConfig();
    const imageEnabled = isFeatureEnabled(config, "image_recognition");
    const weightToolNames = [
      "add_weight",
      "get_latest_weight",
      "get_weight_stats",
    ];
    const mealToolNames = [
      "add_meal_record",
      "get_daily_calories",
      "get_meal_stats",
    ];

    api.registerTool((ctx) => createWeightTools(ctx), {
      names: weightToolNames,
    });
    api.registerTool((ctx) => createMealTools(imageEnabled, ctx), {
      names: mealToolNames,
    });

    api.logger.info(
      `Registered ${weightToolNames.length + mealToolNames.length} tools (image_recognition: ${imageEnabled ? "ON" : "OFF"})`
    );
  },
};

export default plugin;
