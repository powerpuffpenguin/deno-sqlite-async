import { Raw } from "../mod.ts";

const db = await Raw.open("test.db");
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
} finally {
  db.close();
}
