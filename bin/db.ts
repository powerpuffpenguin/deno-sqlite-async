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
  let i = 1;
  for (const name of ["Peter Parker", "Clark Kent", "Bruce Wayne"]) {
    const id = await db.rawInsert("INSERT INTO people (id,name) VALUES (?,?)", {
      args: [i++, name],
    });
    console.log(id);
  }

  for (
    const [id, name] of await db.raw.query("SELECT id,name FROM people")
  ) {
    console.log(id, name);
  }
} finally {
  db.close();
}
