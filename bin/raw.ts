import { Raw } from "../mod.ts";

const db = await Raw.open("test_raw.db");
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
} finally {
  db.close();
}
