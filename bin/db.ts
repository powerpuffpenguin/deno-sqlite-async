import { DB } from "../mod.ts";
const db = await DB.open("test.db");
try {
  console.log("open db:", db.path);
  await db.execute(
    `CREATE TABLE IF NOT EXISTS people (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT
  );
  DELETE FROM people;`,
  );

  for (const name of ["Peter Parker", "Clark Kent", "Bruce Wayne"]) {
    const val = await db.rawInsert("INSERT INTO people (name) VALUES (?)", {
      args: [name],
    });
    console.log(val);
  }
  console.log(
    await db.raw.query(
      "INSERT INTO people (name) VALUES (?); SELECT last_insert_rowid();",
      {
        args: ["1"],
      },
    ),
  );
  for (
    const [id, name] of await db.raw.query("SELECT id,name FROM people")
  ) {
    console.log(id, name);
  }
} finally {
  db.close();
}
