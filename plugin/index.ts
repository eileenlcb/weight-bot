import { type Tool } from "@anthropic-ai/sdk";

const API_BASE = "http://127.0.0.1:8000";

async function callApi(path: string, body: Record<string, unknown>) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

export default {
  name: "weight-tools",
  tools: [
    {
      name: "add_weight",
      description:
        "记录用户体重。当用户告诉你体重数据时调用此工具。",
      parameters: {
        type: "object",
        properties: {
          user_id: { type: "string", description: "用户唯一标识" },
          weight: { type: "number", description: "体重数值，单位 kg" },
          recorded_at: {
            type: "string",
            description: "记录时间，ISO8601 格式；为空则用当前时间",
          },
          source_text: {
            type: "string",
            description: "用户原始输入文本",
          },
        },
        required: ["user_id", "weight"],
      },
      execute: async (params: Record<string, unknown>) =>
        callApi("/tool/add_weight", params),
    },
    {
      name: "get_latest_weight",
      description: "获取用户最近一条体重记录。",
      parameters: {
        type: "object",
        properties: {
          user_id: { type: "string", description: "用户唯一标识" },
        },
        required: ["user_id"],
      },
      execute: async (params: Record<string, unknown>) =>
        callApi("/tool/get_latest_weight", params),
    },
    {
      name: "get_weight_stats",
      description:
        "获取用户一段时间内的体重统计（平均、最高、最低、变化趋势）。",
      parameters: {
        type: "object",
        properties: {
          user_id: { type: "string", description: "用户唯一标识" },
          days: {
            type: "number",
            description: "统计最近多少天，1-365",
          },
        },
        required: ["user_id"],
      },
      execute: async (params: Record<string, unknown>) =>
        callApi("/tool/get_weight_stats", params),
    },
    {
      name: "add_meal_record",
      description:
        "记录用户的一餐饮食。当用户发送食物图片或描述吃了什么时，分析食物内容，估算卡路里和营养成分，然后调用此工具记录。",
      parameters: {
        type: "object",
        properties: {
          user_id: { type: "string", description: "用户唯一标识" },
          meal_type: {
            type: "string",
            enum: ["breakfast", "lunch", "dinner", "snack", "other"],
            description: "餐食类型",
          },
          food_items: {
            type: "array",
            description: "识别到的食物列表",
            items: {
              type: "object",
              properties: {
                name: { type: "string", description: "食物名称" },
                amount: {
                  type: "string",
                  description: "份量描述，如 '100g', '1碗'",
                },
                calories: {
                  type: "number",
                  description: "该食物预估卡路里 (kcal)",
                },
              },
              required: ["name"],
            },
          },
          estimated_calories: {
            type: "number",
            description: "本餐预估总卡路里 (kcal)",
          },
          protein_g: {
            type: "number",
            description: "预估蛋白质 (g)",
          },
          fat_g: { type: "number", description: "预估脂肪 (g)" },
          carb_g: {
            type: "number",
            description: "预估碳水化合物 (g)",
          },
          fiber_g: {
            type: "number",
            description: "预估膳食纤维 (g)",
          },
          image_description: {
            type: "string",
            description: "图片中食物的文字描述",
          },
          advice: {
            type: "string",
            description: "营养建议和减肥提醒",
          },
          recorded_at: {
            type: "string",
            description: "记录时间，ISO8601 格式；为空则用当前时间",
          },
        },
        required: ["user_id", "food_items", "estimated_calories"],
      },
      execute: async (params: Record<string, unknown>) =>
        callApi("/tool/add_meal_record", params),
    },
    {
      name: "get_daily_calories",
      description:
        "获取用户某天的饮食记录和总热量摄入。查看今天或指定日期吃了什么、摄入了多少卡路里。",
      parameters: {
        type: "object",
        properties: {
          user_id: { type: "string", description: "用户唯一标识" },
          date: {
            type: "string",
            description: "查询日期 YYYY-MM-DD，为空则查今天",
          },
        },
        required: ["user_id"],
      },
      execute: async (params: Record<string, unknown>) =>
        callApi("/tool/get_daily_calories", params),
    },
    {
      name: "get_meal_stats",
      description:
        "获取用户一段时间内的饮食统计（每日平均卡路里、最高最低、每日明细）。",
      parameters: {
        type: "object",
        properties: {
          user_id: { type: "string", description: "用户唯一标识" },
          days: {
            type: "number",
            description: "统计最近多少天，1-365",
          },
        },
        required: ["user_id"],
      },
      execute: async (params: Record<string, unknown>) =>
        callApi("/tool/get_meal_stats", params),
    },
  ],
};
