// deno-lint-ignore-file no-explicit-any
import { assertEquals } from "./deps/std/testing/asserts.ts";
import { DB } from "./db.ts";
const table = "king";
const columnID = "id";
const columnName = "name";
const createSQL = `CREATE TABLE IF NOT EXISTS ${table} (
    ${columnID} INTEGER PRIMARY KEY AUTOINCREMENT,
    ${columnName} TEXT
);`;
Deno.test("Batch", async () => {
  const db = await DB.open();
  db.showSQL = true;
  try {
    const batch = db.batch();
    batch.execute(createSQL);
    batch.delete(table);
    batch.rawInsert(
      `INSERT INTO ${table} (${columnID}, ${columnName}) VALUES (?,?)`,
      {
        name: "v1",
        args: [1, "n1"],
      },
    );
    for (let i = 2; i <= 10; i++) {
      batch.insert(table, {
        "id": i,
        "name": `n${i}`,
      }, {
        name: `v${i}`,
      });
    }
    const result = await batch.commit();
    const values = batch.values()!;
    for (let i = 1; i < 10; i++) {
      assertEquals(result[i].sql, i as any);
      assertEquals(values.get(`v${i}`), i);
    }
  } finally {
    db.close();
  }
});
