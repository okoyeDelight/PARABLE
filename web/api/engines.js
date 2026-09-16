import { db } from "hatchable";

export const access = "public";
export const methods = ["GET"];

export default async function (_req, res) {
  const { rows } = await db.query(
    `SELECT engine_key, display_name, engine_type, status, version
     FROM engine_modules
     ORDER BY display_name`
  );
  res.json(rows);
}
