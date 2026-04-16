import type { OpenClawPluginApi, AnyAgentTool } from "openclaw/plugin-sdk";
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

function createWeightTools(): AnyAgentTool[] {
  return [
    {
      name: "add_weight",
      description: "记录用户体重。当用户告诉你体重数据时调用此工具。",
      input: Type.Object({
        user_id: Type.String({ description: "用户唯一标识" }),
        weight: Type.Number({ description: "体重数值，单位 kg" }),
        recorded_at: Type.Optional(
          Type.String({ description: "记录时间，ISO8601 格式；为空则用当前时间" })
        ),
        source_text: Type.Optional(
          Type.String({ description: "用户原始输入文本" })
        ),
      }),
      execute: async (args: Record<string, unknown>) => {
        try {
          const result = await callApi("/tool/add_weight", args);
          return { result: "success", details: result };
        } catch (err) {
          return { result: "error", error: String(err) };
        }
      },
    },
    {
      name: "get_latest_weight",
      description: "获取用户最近一条体重记录。",
      input: Type.Object({
        user_id: Type.String({ description: "用户唯一标识" }),
      }),
      execute: async (args: Record<string, unknown>) => {
        try {
          const result = await callApi("/tool/get_latest_weight", args);
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
      input: Type.Object({
        user_id: Type.String({ description: "用户唯一标识" }),
        days: Type.Optional(
          Type.Integer({ description: "统计最近多少天，1-365", default: 7 })
        ),
      }),
      execute: async (args: Record<string, unknown>) => {
        try {
          const result = await callApi("/tool/get_weight_stats", args);
          return { result: "success", details: result };
        } catch (err) {
          return { result: "error", error: String(err) };
        }
      },
    },
  ];
}

function createMealTools(imageEnabled: boolean): AnyAgentTool[] {
  const addMealDesc = imageEnabled
    ? "记录用户的一餐饮食。当用户发送食物图片或描述吃了什么时，分析食物内容，估算卡路里和营养成分，然后调用此工具记录。"
    : "记录用户的一餐饮食。当用户用文字描述吃了什么时，根据描述估算卡路里和营养成分，然后调用此工具记录。注意：图片识别功能未开启，如果用户发送了食物图片，请提醒用户用文字描述食物内容和大致份量。";

  return [
    {
      name: "add_meal_record",
      description: addMealDesc,
      input: Type.Object({
        user_id: Type.String({ description: "用户唯一标识" }),
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
      execute: async (args: Record<string, unknown>) => {
        try {
          const result = await callApi("/tool/add_meal_record", args);
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
      input: Type.Object({
        user_id: Type.String({ description: "用户唯一标识" }),
        date: Type.Optional(
          Type.String({ description: "查询日期 YYYY-MM-DD，为空则查今天" })
        ),
      }),
      execute: async (args: Record<string, unknown>) => {
        try {
          const result = await callApi("/tool/get_daily_calories", args);
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
      input: Type.Object({
        user_id: Type.String({ description: "用户唯一标识" }),
        days: Type.Optional(
          Type.Integer({ description: "统计最近多少天，1-365", default: 7 })
        ),
      }),
      execute: async (args: Record<string, unknown>) => {
        try {
          const result = await callApi("/tool/get_meal_stats", args);
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

    const tools = createWeightTools();
    for (const tool of tools) {
      api.registerTool(tool as unknown as AnyAgentTool, { optional: true });
    }

    const mealTools = createMealTools(imageEnabled);
    for (const tool of mealTools) {
      api.registerTool(tool as unknown as AnyAgentTool, { optional: true });
    }

    api.logger.info(
      `Registered ${tools.length + mealTools.length} tools (image_recognition: ${imageEnabled ? "ON" : "OFF"})`
    );
  },
};

export default plugin;
