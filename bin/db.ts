import { DB } from "../mod.ts";
const db = await DB.open("test.db", {
  showSQL: true,
});
async function displayAll() {
  console.log(await db.query("people"));
}
try {
  console.log("open db:", db.path);
  await db.execute(
    `CREATE TABLE IF NOT EXISTS people (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT
  );
  DELETE FROM people;`,
  );

  // insert
  let i = 1;
  for (const name of ["Peter Parker", "Clark Kent", "Bruce Wayne", "Kate"]) {
    const id = await db.insert("people", {
      id: i++,
      name: name,
    });
    console.log("insert_id:", id);
  }

  // query
  const rows = await db.query("people", {
    columns: ["id", "name", "id as val"],
    limit: 2,
    offset: 1,
    orderBy: "val desc",
  });
  console.log(rows);

  // update
  const changed = await db.update(
    "people",
    {
      name: "k1",
    },
    {
      where: "id = ? or id = ?",
      args: [1, 3],
    },
  );
  console.log("changed:", changed);
  await db.update(
    "people",
    {
      name: "k2",
    },
    {
      where: "id = :id", // Use secret named parameters
      args: {
        id: 2,
      },
    },
  );

  // delete
  console.log(
    "deleted:",
    await db.delete("people", {
      where: "id = ?",
      args: [4],
    }),
  );

  await displayAll();

  // Prepared
  const p = await db.prepare("select * from people where id = ?");
  console.log(await p.columns());
} finally {
  db.close();
}
