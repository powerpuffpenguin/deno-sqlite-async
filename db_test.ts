// deno-lint-ignore-file no-explicit-any
import { assertEquals } from "./deps/std/testing/asserts.ts";
import { DB } from "./db.ts";
import { Conflict, Preparor } from "./executor.ts";
import { RowObject } from "./sqlite.ts";
import { Method } from "./caller.ts";
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
    batch.execute(createSQL)
      .delete(table, { name: "v0" })
      .rawInsert(
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
      name: "name5",
    }, {
      name: "u5",
      where: `${columnName} = ?`,
      args: ["n5"],
    });

    batch.queryEntries(table, {
      name: "q2",
      distinct: true,
      columns: [columnID, columnName],
      where: `${columnID} > ?`,
      args: [3],
      limit: 2,
      offset: 1,
      orderBy: `${columnID} desc`,
    });

    batch.queryEntries(table, {
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
    assertEquals(values.get("u5"), 1);
    const q2 = values.get("q2") as Array<RowObject>;
    assertEquals(q2, [
      { id: 8, name: "n8" },
      { id: 7, name: "n7" },
    ]);
    const q8 = values.get("q8") as Array<RowObject>;
    assertEquals(q8, [
      { id: 3, name: "name3" },
      { id: 4, name: "n4" },
      { id: 5, name: "name5" },
      { id: 6, name: "n6" },
      { id: 7, name: "n7" },
      { id: 8, name: "n8" },
      { id: 9, name: "n9" },
    ]);
  } finally {
    db.close();
  }
});
Deno.test("Batch prepare", async () => {
  const db = await DB.open();
  try {
    await db.execute(createSQL);

    let batch = db.batch();
    batch
      .prepareDelete(table, { name: "d" })
      .prepareInsert(table, [columnID, columnName], { name: "i" })
      .prepareInsert(table, [columnID, columnName], {
        name: "i3",
        conflict: Conflict.replace,
      })
      .prepareInsert(table, [columnID, columnName], {
        name: "i4",
        conflict: Conflict.ignore,
      });

    batch
      .prepareDelete(table, {
        name: "d2",
        where: `${columnID} < ? or ${columnName} = ?`,
      })
      .prepareDelete(table, {
        name: "d1",
        where: `${columnID} = :id`,
      })
      .prepareUpdate(table, [columnName], {
        name: "u5",
        where: `${columnName} = ?`,
      });

    batch
      .prepareQuery(table, {
        name: "q2",
        distinct: true,
        columns: [columnID, columnName],
        where: `${columnID} > ?`,
        limit: 2,
        offset: 1,
        orderBy: `${columnID} desc`,
      })
      .prepareQuery(table, {
        name: "q8",
        orderBy: `${columnID}`,
      });

    await batch.commit();
    let values = batch.values()!;

    batch = db.batch();
    batch.method(
      values.get("d") as any,
      Method.execute,
    );
    const p = values.get("i") as Preparor;
    for (let i = 1; i <= 10; i++) {
      batch.method(p, Method.execute, {
        args: [i, `n${i}`],
      });
    }
    batch
      .method(values.get("i3") as any, Method.execute, {
        args: [3, "name3"],
      })
      .method(values.get("i4") as any, Method.execute, {
        args: [4, "name4"],
      });

    batch
      .method(values.get("d2") as any, Method.execute, {
        args: [2, "n10"],
      })
      .method(values.get("d1") as any, Method.execute, {
        args: {
          id: 2,
        },
      })
      .method(values.get("u5") as any, Method.execute, {
        args: ["name5", "n5"],
      });

    batch
      .method(values.get("q2") as any, Method.allEntries, {
        name: "q2",
        args: [3],
      })
      .method(values.get("q8") as any, Method.allEntries, {
        name: "q8",
      });

    await batch.commit();
    values = batch.values()!;
    const q2 = values.get("q2") as Array<RowObject>;
    assertEquals(q2, [
      { id: 8, name: "n8" },
      { id: 7, name: "n7" },
    ]);
    const q8 = values.get("q8") as Array<RowObject>;
    assertEquals(q8, [
      { id: 3, name: "name3" },
      { id: 4, name: "n4" },
      { id: 5, name: "name5" },
      { id: 6, name: "n6" },
      { id: 7, name: "n7" },
      { id: 8, name: "n8" },
      { id: 9, name: "n9" },
    ]);
  } finally {
    db.close();
  }
});
Deno.test("Prepared", async () => {
  const db = await DB.open();
  try {
    await (await db.prepare(createSQL)).execute();
    await (await db.prepareDelete(table)).execute();
    const p = await db.prepareInsert(table, [columnID, columnName]);
    for (let i = 1; i < 10; i++) {
      await p.execute({
        args: [i, `n${i}`],
      });
    }
    await (await db.prepareInsert(table, [columnID, columnName], {
      conflict: Conflict.replace,
    })).execute({
      args: [3, "name3"],
    });
    await (await db.prepareInsert(table, [columnID, columnName], {
      conflict: Conflict.ignore,
    })).execute({
      args: [4, "name4"],
    });
    await (await db.prepareDelete(table, {
      where: `${columnID} < ? or ${columnName} = ?`,
    })).execute({
      args: [2, "n10"],
    });
    await (await db.prepareDelete(table, {
      where: `${columnID} = :id`,
    })).execute({
      args: {
        id: 2,
      },
    });

    await (await db.prepareUpdate(table, [columnName], {
      where: `${columnName} = ?`,
    })).execute({
      args: ["name5", "n5"],
    });

    const q2 = await (await db.prepareQuery(table, {
      distinct: true,
      columns: [columnID, columnName],
      where: `${columnID} > ?`,
      limit: 2,
      offset: 1,
      orderBy: `${columnID} desc`,
    })).allEntries({
      args: [3],
    });
    const q8 = await (await db.prepareQuery(table, {
      orderBy: `${columnID}`,
    })).allEntries();

    assertEquals(q2, [
      { id: 8, name: "n8" },
      { id: 7, name: "n7" },
    ]);
    assertEquals(q8, [
      { id: 3, name: "name3" },
      { id: 4, name: "n4" },
      { id: 5, name: "name5" },
      { id: 6, name: "n6" },
      { id: 7, name: "n7" },
      { id: 8, name: "n8" },
      { id: 9, name: "n9" },
    ]);
  } finally {
    db.close();
  }
});
