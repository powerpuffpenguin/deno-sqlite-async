import { Method, RawDB } from "../mod.ts";
const db = await RawDB.open("test_raw.db");
try {
  console.log("open db:", db.path);
  await db.execute(
    `CREATE TABLE IF NOT EXISTS people (
id INTEGER PRIMARY KEY AUTOINCREMENT,
name TEXT
);
DELETE FROM people;`,
  );

  let i = 0;
  for (const name of ["Peter Parker", "Clark Kent", "Bruce Wayne"]) {
    await db.query("INSERT INTO people (id,name) VALUES (?,?)", {
      args: [++i, name],
    });
  }

  for (
    const [id, name] of await db.query("SELECT id,name FROM people")
  ) {
    console.log(id, name);
  }

  console.log("---  batch ---");
  const rows = await db.batch({
    batch: [
      {
        sql: "SELECT id,name FROM people",
        result: true,
      },
      {
        sql: "INSERT INTO people (id,name) VALUES (?,?)",
        args: [4, "Kate"],
      },
      {
        sql: "SELECT last_insert_rowid()",
        result: true,
      },
      {
        sql: "update people set name=? where id <4",
        args: ["kk"],
      },
      {
        sql: "SELECT changes()",
        result: true,
      },
      {
        sql: "SELECT id,name FROM people where id > 2",
        result: true,
      },
    ],
  });
  console.log(rows);

  //
  const items = [];
  for (let i = 0; i < 100000; i++) {
    items.push(i);
  }
  const last = Date.now();
  await db.execute("begin");

  // for (const v of items) {
  //   await db.execute("INSERT INTO people (name) VALUES (?)", {
  //     args: [`${v}`],
  //   })
  // }

  // await db.batch({
  //   batch: items.map((v) => {
  //     return {
  //       sql: "INSERT INTO people (id,name) VALUES (?,?)",
  //       args: [100 + v, `${v}`],
  //     };
  //   }),
  // });
  const prepared = await db.prepare(
    "INSERT INTO people (id,name) VALUES (?,?)",
  );
  try {
    // for (const v of items) {
    //   await prepared.execute({
    //     args: [100 + v, `${v}`],
    //   });
    // }
    // await db.batch({
    //   batch: items.map((v) => {
    //     return {
    //       sql: prepared,
    //       method: Method.execute,
    //       args: [100 + v, `${v}`],
    //     };
    //   }),
    // });

    await prepared.batch(items.map((v) => {
      return {
        method: Method.execute,
        args: [100 + v, `${v}`],
      };
    }));
  } finally {
    await prepared.close();
  }
  await db.execute("end");
  console.log((Date.now() - last) / 1000);
  console.log(await db.query("select count(id) from people"));
} finally {
  db.close();
}
