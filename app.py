from fastapi import FastAPI
from pydantic import BaseModel, Field
import sqlite3
import json
import os
from datetime import datetime, timedelta
from typing import Optional, List

app = FastAPI(title="Weight Bot API")
DB_PATH = "weight.db"
CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.json")


def load_config():
    defaults = {"features": {"meal_tracking": False, "image_recognition": False}}
    if not os.path.exists(CONFIG_PATH):
        return defaults
    with open(CONFIG_PATH, "r") as f:
        return json.load(f)


config = load_config()


def feature_enabled(name: str) -> bool:
    return config.get("features", {}).get(name, False)


def get_conn():
    return sqlite3.connect(DB_PATH)


def init_db():
    conn = get_conn()
    cursor = conn.cursor()
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS weight_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        recorded_at TEXT NOT NULL,
        weight REAL NOT NULL,
        unit TEXT NOT NULL DEFAULT 'kg',
        source_text TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
    """)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS meal_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        meal_type TEXT NOT NULL DEFAULT 'other',
        food_items TEXT NOT NULL,
        estimated_calories REAL NOT NULL DEFAULT 0,
        protein_g REAL NOT NULL DEFAULT 0,
        fat_g REAL NOT NULL DEFAULT 0,
        carb_g REAL NOT NULL DEFAULT 0,
        fiber_g REAL NOT NULL DEFAULT 0,
        image_description TEXT,
        advice TEXT,
        recorded_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
    """)
    conn.commit()
    conn.close()


init_db()


class WeightInput(BaseModel):
    user_id: str = Field(..., description="用户唯一标识")
    weight: float = Field(..., description="体重数值，单位 kg")
    recorded_at: Optional[str] = Field(None, description="记录时间，ISO8601 格式；为空则用当前时间")
    source_text: str = Field("", description="用户原始输入")


class StatsInput(BaseModel):
    user_id: str = Field(..., description="用户唯一标识")
    days: int = Field(7, ge=1, le=365, description="统计最近多少天")


class LatestInput(BaseModel):
    user_id: str = Field(..., description="用户唯一标识")


class FoodItem(BaseModel):
    name: str = Field(..., description="食物名称")
    amount: str = Field("", description="份量描述，如 '100g', '1碗', '1个'")
    calories: float = Field(0, description="该食物预估卡路里 (kcal)")


class MealRecordInput(BaseModel):
    user_id: str = Field(..., description="用户唯一标识")
    meal_type: str = Field("other", description="餐食类型: breakfast/lunch/dinner/snack/other")
    food_items: List[FoodItem] = Field(..., description="识别到的食物列表")
    estimated_calories: float = Field(..., description="本餐预估总卡路里 (kcal)")
    protein_g: float = Field(0, description="预估蛋白质 (g)")
    fat_g: float = Field(0, description="预估脂肪 (g)")
    carb_g: float = Field(0, description="预估碳水化合物 (g)")
    fiber_g: float = Field(0, description="预估膳食纤维 (g)")
    image_description: str = Field("", description="图片中食物的文字描述")
    advice: str = Field("", description="营养建议和减肥提醒")
    recorded_at: Optional[str] = Field(None, description="记录时间，ISO8601 格式；为空则用当前时间")


class DailyCaloriesInput(BaseModel):
    user_id: str = Field(..., description="用户唯一标识")
    date: Optional[str] = Field(None, description="查询日期，格式 YYYY-MM-DD；为空则查今天")


class MealStatsInput(BaseModel):
    user_id: str = Field(..., description="用户唯一标识")
    days: int = Field(7, ge=1, le=365, description="统计最近多少天")


@app.get("/")
def root():
    return {
        "ok": True,
        "message": "Weight Bot API is running",
        "features": config.get("features", {}),
    }


@app.post("/tool/add_weight")
def tool_add_weight(data: WeightInput):
    recorded_at = data.recorded_at or datetime.now().isoformat()

    conn = get_conn()
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO weight_records (user_id, recorded_at, weight, unit, source_text)
    VALUES (?, ?, ?, ?, ?)
    """, (data.user_id, recorded_at, data.weight, "kg", data.source_text))
    conn.commit()

    cursor.execute("""
    SELECT weight, recorded_at
    FROM weight_records
    WHERE user_id = ?
    ORDER BY recorded_at DESC
    LIMIT 2
    """, (data.user_id,))
    rows = cursor.fetchall()
    conn.close()

    delta = None
    if len(rows) >= 2:
        delta = round(rows[0][0] - rows[1][0], 2)

    return {
        "ok": True,
        "message": f"已记录体重 {data.weight}kg",
        "record": {
            "user_id": data.user_id,
            "weight": data.weight,
            "unit": "kg",
            "recorded_at": recorded_at,
            "source_text": data.source_text
        },
        "delta_from_previous": delta
    }


@app.post("/tool/get_latest_weight")
def tool_get_latest_weight(data: LatestInput):
    conn = get_conn()
    cursor = conn.cursor()
    cursor.execute("""
    SELECT weight, recorded_at, source_text
    FROM weight_records
    WHERE user_id = ?
    ORDER BY recorded_at DESC
    LIMIT 1
    """, (data.user_id,))
    row = cursor.fetchone()
    conn.close()

    if not row:
        return {
            "ok": False,
            "message": "暂无体重记录"
        }

    return {
        "ok": True,
        "latest": {
            "weight": row[0],
            "unit": "kg",
            "recorded_at": row[1],
            "source_text": row[2]
        }
    }


@app.post("/tool/get_weight_stats")
def tool_get_weight_stats(data: StatsInput):
    since = (datetime.now() - timedelta(days=data.days)).isoformat()

    conn = get_conn()
    cursor = conn.cursor()
    cursor.execute("""
    SELECT weight, recorded_at
    FROM weight_records
    WHERE user_id = ? AND recorded_at >= ?
    ORDER BY recorded_at ASC
    """, (data.user_id, since))
    rows = cursor.fetchall()
    conn.close()

    if not rows:
        return {
            "ok": False,
            "message": f"最近 {data.days} 天暂无体重记录"
        }

    weights = [r[0] for r in rows]
    first_weight = weights[0]
    last_weight = weights[-1]
    change = round(last_weight - first_weight, 2)

    return {
        "ok": True,
        "days": data.days,
        "count": len(weights),
        "avg": round(sum(weights) / len(weights), 2),
        "min": min(weights),
        "max": max(weights),
        "first_weight": first_weight,
        "last_weight": last_weight,
        "change": change,
        "trend": (
            "下降" if change < 0 else
            "上升" if change > 0 else
            "持平"
        ),
        "records": [
            {
                "weight": w,
                "recorded_at": t
            } for w, t in rows
        ]
    }


@app.post("/tool/add_meal_record")
def tool_add_meal_record(data: MealRecordInput):
    recorded_at = data.recorded_at or datetime.now().isoformat()
    food_items_json = json.dumps(
        [item.model_dump() for item in data.food_items], ensure_ascii=False
    )

    conn = get_conn()
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO meal_records
        (user_id, meal_type, food_items, estimated_calories,
         protein_g, fat_g, carb_g, fiber_g,
         image_description, advice, recorded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        data.user_id, data.meal_type, food_items_json,
        data.estimated_calories, data.protein_g, data.fat_g,
        data.carb_g, data.fiber_g,
        data.image_description, data.advice, recorded_at
    ))
    conn.commit()

    today = datetime.now().strftime("%Y-%m-%d")
    cursor.execute("""
    SELECT SUM(estimated_calories), SUM(protein_g), SUM(fat_g), SUM(carb_g)
    FROM meal_records
    WHERE user_id = ? AND recorded_at >= ?
    """, (data.user_id, today))
    totals = cursor.fetchone()
    conn.close()

    return {
        "ok": True,
        "message": f"已记录{data.meal_type}，预估 {data.estimated_calories} kcal",
        "record": {
            "user_id": data.user_id,
            "meal_type": data.meal_type,
            "food_items": [item.model_dump() for item in data.food_items],
            "estimated_calories": data.estimated_calories,
            "protein_g": data.protein_g,
            "fat_g": data.fat_g,
            "carb_g": data.carb_g,
            "fiber_g": data.fiber_g,
            "image_description": data.image_description,
            "advice": data.advice,
            "recorded_at": recorded_at
        },
        "daily_totals": {
            "total_calories": round(totals[0] or 0, 1),
            "total_protein_g": round(totals[1] or 0, 1),
            "total_fat_g": round(totals[2] or 0, 1),
            "total_carb_g": round(totals[3] or 0, 1)
        }
    }


@app.post("/tool/get_daily_calories")
def tool_get_daily_calories(data: DailyCaloriesInput):
    target_date = data.date or datetime.now().strftime("%Y-%m-%d")

    conn = get_conn()
    cursor = conn.cursor()
    cursor.execute("""
    SELECT meal_type, food_items, estimated_calories,
           protein_g, fat_g, carb_g, fiber_g, advice, recorded_at
    FROM meal_records
    WHERE user_id = ? AND recorded_at >= ? AND recorded_at < ?
    ORDER BY recorded_at ASC
    """, (data.user_id, target_date, target_date + "T23:59:59"))
    rows = cursor.fetchall()
    conn.close()

    if not rows:
        return {
            "ok": False,
            "message": f"{target_date} 暂无饮食记录"
        }

    meals = []
    total_cal = 0
    total_protein = 0
    total_fat = 0
    total_carb = 0
    total_fiber = 0
    for r in rows:
        cal = r[2]
        total_cal += cal
        total_protein += r[3]
        total_fat += r[4]
        total_carb += r[5]
        total_fiber += r[6]
        meals.append({
            "meal_type": r[0],
            "food_items": json.loads(r[1]),
            "estimated_calories": cal,
            "protein_g": r[3],
            "fat_g": r[4],
            "carb_g": r[5],
            "fiber_g": r[6],
            "advice": r[7],
            "recorded_at": r[8]
        })

    return {
        "ok": True,
        "date": target_date,
        "meal_count": len(meals),
        "total_calories": round(total_cal, 1),
        "total_protein_g": round(total_protein, 1),
        "total_fat_g": round(total_fat, 1),
        "total_carb_g": round(total_carb, 1),
        "total_fiber_g": round(total_fiber, 1),
        "meals": meals
    }


@app.post("/tool/get_meal_stats")
def tool_get_meal_stats(data: MealStatsInput):
    since = (datetime.now() - timedelta(days=data.days)).strftime("%Y-%m-%d")

    conn = get_conn()
    cursor = conn.cursor()
    cursor.execute("""
    SELECT DATE(recorded_at) as day,
           SUM(estimated_calories), SUM(protein_g),
           SUM(fat_g), SUM(carb_g), COUNT(*)
    FROM meal_records
    WHERE user_id = ? AND recorded_at >= ?
    GROUP BY DATE(recorded_at)
    ORDER BY day ASC
    """, (data.user_id, since))
    rows = cursor.fetchall()
    conn.close()

    if not rows:
        return {
            "ok": False,
            "message": f"最近 {data.days} 天暂无饮食记录"
        }

    daily_calories = [r[1] for r in rows]
    daily_records = [{
        "date": r[0],
        "total_calories": round(r[1], 1),
        "total_protein_g": round(r[2], 1),
        "total_fat_g": round(r[3], 1),
        "total_carb_g": round(r[4], 1),
        "meal_count": r[5]
    } for r in rows]

    return {
        "ok": True,
        "days": data.days,
        "recorded_days": len(rows),
        "avg_daily_calories": round(sum(daily_calories) / len(daily_calories), 1),
        "min_daily_calories": round(min(daily_calories), 1),
        "max_daily_calories": round(max(daily_calories), 1),
        "total_calories": round(sum(daily_calories), 1),
        "daily_records": daily_records
    }
