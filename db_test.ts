// deno-lint-ignore-file no-explicit-any
import { assertEquals } from "./deps/std/testing/asserts.ts";
import { DB } from "./db.ts";
import { Conflict } from "./executor.ts";
import { RowObject } from "./sqlite.ts";
const table = "king";
const columnID = "id";
const columnName = "name";
const createSQL = `CREATE TABLE IF NOT EXISTS ${table} (
    ${columnID} INTEGER PRIMARY KEY AUTOINCREMENT,
    ${columnName} TEXT
);`;
Deno.test("Batch", async () => {
  const db = await DB.open();
  try {
    const batch = db.batch();
    batch.execute(createSQL);
    batch.delete(table, { name: "v0" });
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
    batch.insert(table, {
      id: 3,
      name: "name3",
    }, {
      conflict: Conflict.replace,
    });
    batch.insert(table, {
      id: 4,
      name: "name4",
    }, {
      conflict: Conflict.ignore,
    });

    batch.delete(table, {
      name: "d2",
      where: `${columnID} < ? or ${columnName} = ?`,
      args: [2, "n10"],
    });
    batch.rawDelete(`DELETE FROM ${table} WHERE ${columnID} = :id`, {
      name: "d1",
      args: {
        id: 2,
      },
    });
    batch.update(table, {
      name: "n3",
    }, {
      name: "u3",
      where: `${columnName} = ?`,
      args: ["name3"],
    });

    batch.query(table, {
      name: "q2",
      distinct: true,
      columns: [columnID, columnName],
      where: `${columnID} > ?`,
      args: [3],
      limit: 2,
      offset: 1,
      orderBy: `${columnID} desc`,
    });

    batch.query(table, {
      name: "q8",
      orderBy: `${columnID}`,
    });
    const result = await batch.commit({
      savepoint: true,
    });
    const values = batch.values()!;
    for (let i = 0; i < 10; i++) {
      assertEquals(result[i].sql, i as any);
      assertEquals(values.get(`v${i}`), i);
    }
    assertEquals(values.get("d2"), 2);
    assertEquals(values.get("d1"), 1);
    assertEquals(values.get("u3"), 1);
    const q2 = values.get("q2") as Array<RowObject>;
    assertEquals(q2, [
      { id: 8, name: "n8" },
      { id: 7, name: "n7" },
    ]);
    const q8 = values.get("q8") as Array<RowObject>;
    assertEquals(q8, [
      { id: 3, name: "n3" },
      { id: 4, name: "n4" },
      { id: 5, name: "n5" },
      { id: 6, name: "n6" },
      { id: 7, name: "n7" },
      { id: 8, name: "n8" },
      { id: 9, name: "n9" },
    ]);
  } finally {
    db.close();
  }
});
