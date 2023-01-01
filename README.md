# deno-sqlite-async

deno sqlite3 async

Run [x/sqlite](https://deno.land/x/sqlite) in a web worker, providing an
asynchronous api interface for sqlite

```
import { DB, Conflict } from "https://deno.land/x/sqlite_async/mod.ts"

const table = "people";
const columnID = "id";
const columnName = "name";
const createSQL = `CREATE TABLE IF NOT EXISTS ${table} (
    ${columnID} INTEGER PRIMARY KEY AUTOINCREMENT,
    ${columnName} TEXT
);`;

// open db
const db = await DB.open("test.db", {
    version: 1,
    showSQL: true,
    onCreate(txn) {
        return txn.execute(createSQL)
    }
});

try {
    // transaction
    await db.transaction(async (txn) => {
        for (let i = 1; i <= 10; i++) {
            // insert
            await txn.insert(table,
                {
                    id: i,
                    name: `name-${i}`,
                },
                {
                    conflict: Conflict.replace,
                },
            )
        }
    })

    // query
    const rows = await db.queryEntries(table, {
        distinct: true,
        where: `${columnID} > ?`,
        args: [0],
        orderBy: `${columnID} desc`,
    })
    for (const row of rows) {
        console.log(`id=${row.id} name=${row.name}`)
    }
} finally {
    db.close();
}
```

index:

- [db](#db)
  - [open](#open)
  - [execute](#execute)
  - [insert](#insert)
  - [delete](#delete)
  - [update](#update)
  - [query](#query)
  - [prepare](#prepare)
  - [batch](#batch)
  - [transactions](#transactions)
  - [locker](#locker)
  - [prepare-in-transactions](#prepare-in-transactions)
  - [context](#context)
- [rawdb](#rawdb)

# db

class DB is a higher-level package, usually using it can operate SQLite as you
expect

In addition, there is a lower-level class RawDB to choose from, which has higher
efficiency, but requires you to handle each step carefully, class DB uses class
RawDB internally

## open

To open a SQLite connection just call the static method DB.open

```
import { DB, } from "https://deno.land/x/sqlite_async/mod.ts"

const db = await DB.open(
  "test.db",
);
try {
  // do something ...
} finally {
  db.close();
}
```

open also supports some optional parameters to provide more functionality

```
const table = "people";
const columnID = "id";
const columnName = "name";

const path = "test.db";
const db = await DB.open(
  path, // or undefined or ":memory:" will use memory
  {
    // You can define the database version,
    //   so that the system will automatically create a table "web_worker_sqlite_system" to record the version,
    //   and notify you through the callback function when the version changes
    version: 1,
    // If it is true, the executed sql statement will be printed through the log
    showSQL: true,
    onOpen(txn: SqlTransaction) {
      // A successful connection will first call this optional callback function
      // You can perform some custom initialization here
      console.log("onOpen");
    },
    async onCreate(txn: SqlTransaction, version: number) {
      // Callback when the database is opened for the first time, you should initialize table view indexes and other operations here
      console.log(`onCreate: ${version}`);

      await txn.execute(`CREATE TABLE IF NOT EXISTS ${table} (
    ${columnID} INTEGER PRIMARY KEY AUTOINCREMENT,
    ${columnName} TEXT
)`);
    },
    onUpgrade(txn: SqlTransaction, oldVersion: number, newVersion) {
      // If the incoming database version is larger than the recorded one, this callback function will be called
      // When your system is upgraded, you can upgrade the database here
      console.log(`onUpgrade : ${oldVersion} -> ${newVersion}`);
    },
    onDowngrade(txn: SqlTransaction, oldVersion: number, newVersion) {
      //  If the incoming database version is less than the recorded one, this callback function will be called
      // You can downgrade the database here, but most systems do not support downgrading. You can set this callback function to undefined so that DB will automatically throw an exception for you.
      console.log(`onDowngrade : ${oldVersion} -> ${newVersion}`);

      throw new Error(
        `not supported downgrade: ${oldVersion} -> ${newVersion}`,
      );
    },
    onReady(txn: SqlTransaction, version: number) {
      // This optional callback function will be called at the end when everything is ready
      console.log(`onReady: ${version}`);
    },
  },
);
try {
  // do something ...
} finally {
  db.close();
}
```

If version is undefined, no callback function will be executed, The execution
order of the callback function is:

1. onOpen
2. onCreate or onUpgrade or onDowngrade
3. onReady

## execute

The execute function is used to execute some sql commands that do not need to
return a value

```
const table = "people";
const columnID = "id";
const columnName = "name";

await db.execute(`CREATE TABLE IF NOT EXISTS ${table} (
    ${columnID} INTEGER PRIMARY KEY AUTOINCREMENT,
    ${columnName} TEXT
)`)
```

## insert

insert helps you build an INSERT command and insert data

```
let id = await db.insert(table, {
    name: "kate",
});
console.log(id);

id = await db.insert(table, {
        id: id,
        name: "jolin",
    }, {
        conflict: Conflict.replace, // Set conflict algorithm
});
console.log(id);
```

You can also use rawInsert to execute raw sql commands

```
const id = await db.rawInsert(
    `INSERT INTO ${table} (${columnName}) VALUES(?)`,
    {
        args: ["kate"],
    },
);
console.log(id);
```

## delete

delete helps you build an DELETE command and delete data

```
const changes = await db.delete(table, {
    where: `${columnID} = ?`,
    args: [100],
});
console.log(`changes: ${changes}`);
```

You can also use rawDelete to execute raw sql commands

```
const changes = await db.rawDelete(
    `DELETE FROM ${table} WHERE ${columnID} = ?`,
    {
        args: [100],
    },
);
console.log(`changes: ${changes}`);
```

## update

update helps you build an UPDATE command and update data

```
const changes = await db.update(table, {
    name: "kate",
    }, {
    where: `${columnID} = ?`,
    args: [1],
});
console.log(`changes: ${changes}`);
```

You can also use rawUpdate to execute raw sql commands

```
const changes = await db.rawUpdate(
    `UPDATE ${table} SET ${columnName} = ? WHERE ${columnID} = ?`,
    {
        args: ["kate", 1],
    },
);
console.log(`changes: ${changes}`);
```

## query

query/queryEntries helps you build an SELECT command and query data

```
const rows = await db.queryEntries(table, {
    distinct: true,
    where: `${columnID} > ?`,
    args: [0],
    limit: 100,
    orderBy: `${columnID} desc`,
});
console.log(`rows`, rows);
```

You can also use rawQuery/rawQueryEntries to execute raw sql commands

```
const rows = await db.rawQueryEntries(
    `SELECT DISTINCT * FROM people WHERE ${columnID} > ? ORDER BY ${columnID} desc LIMIT 100`,
    {
      args: [0],
    },
);
console.log(`rows`, rows);
```

## prepare

prepare Function used to compile an SQL command so that it can be reused

prepareXXX is like prepare but helps you create SQL commands more easily

```
const insert = await db.prepareInsert(table, [columnID, columnName]);
const insertID = db.prepareLastInsertRowid();
const query = await db.prepareQuery(table, {
  columns: [columnID, columnName],
});
for (let i = 1; i < 100; i++) {
  await insert.execute({
    args: [i, `name-${i}`],
  });
  const id = (await insertID.first())![0];
  console.log(`insertID: ${id}`);
}
const rows = await query.allEntries();
console.log(rows);
```

Note that SQLite will not return the inserted id after inserting data, nor will
it return the number of data changes after modifying or deleting data.

class DB automatically executes "SELECT last_insert_rowid()" after insert, and
automatically executes "SELECT changes()" after update/delete

For prepare, you need to call "SELECT last_insert_rowid()" and "SELECTED
changes()" yourself

## batch

Batch is used to submit a batch of commands to the system for execution, which
is more efficient than submitting each command individually. It is used in a
similar way to class DB, except that the returned results of the commands are
all returned together when the commit function is called

```
  const batch = await db.batch();
  for (let i = 1; i < 100; i++) {
    batch.insert(table, {
      id: i,
      name: `name-${i}`,
    });
  }
  batch.queryEntries(table, {
    name: "query", // The return result can be named, so that the return result of a specific command can be obtained by using the name
  });

  // commit and execute
  await batch.commit({
    savepoint: true, // run in savepoint
  });
  // get result by name
  const rows = batch.get<RowObject[]>("query");
  console.log(rows);
```

## transactions

transaction starts a transaction, executes the callback function and
automatically submits it, and automatically rolls back if the callback function
throws an exception

```
await db.transaction(async (txn) => {
  for (let i = 1; i < 100; i++) {
    await txn.insert(table, {
      id: i,
      name: `name-${i}`,
    });
  }
  const rows = await txn.queryEntries(table);
  console.log(rows);
});
```

You can also use begin to manage transactions manually, But this is not
recommended, because if the transaction is not closed, other functions may be
blocked all the time

```
  const txn = await db.begin();
  try {
    for (let i = 1; i < 100; i++) {
      await txn.insert(table, {
        id: i,
        name: `name-${i}`,
      });
    }
    const rows = await txn.queryEntries(table);
    console.log(rows);

    await txn.commit();
  } catch (e) {
    try {
      await txn.rollback();
    } catch (_) {}
    throw e;
  }
```

The savepoint/createSavepoint and transaction/begin functions are used in a
similar way

## locker

Operations on sqlite rely on [x/sqlite](https://deno.land/x/sqlite) but
[x/sqlite](https://deno.land/x/sqlite) cannot be correct handle file locks
because of the use of WebAssembly. And sqlite does not support using BEGIN to
create multiple transactions in the same connection. This causes problems when
using class DB concurrently, so I built some lock operations to Handles
concurrency correctly and supports multiple BEGIN transactions.

All APIs receive an optional parameter locker, which instructs the system how to
lock. If you are not sure what you are doing, please do not set this parameter
and let it work by default.

```
/**
 * The sqlite provided by WebAssembly cannot correctly acquire the file lock, but you can use the lock inside the process, which can ensure that the current process uses sqlite correctly
 */
export enum Locker {
  /**
   * No locking
   */
  none,
  /**
   * Lock shared locks, multiple requests using shared locks may be executed in parallel
   */
  shared,
  /**
   * Lock the exclusive lock, which will ensure that any other requests using the exclusive lock/shared lock will not be executed
   */
  exclusive,
}
export interface LockArgs extends ContextArgs {
  /**
   * How to lock
   */
  lock?: Locker;
}
```

The system will perform the default locking behavior according to the semantics
of the API, so even some APIs can perform multiple functions, but please use
them according to their semantics, for example, do not use rawQuery to update
data

The following table documents the default locking behavior

| API             | no-transactions | in-transactions |
| --------------- | --------------- | --------------- |
| execute         | shared          | exclusive       |
| rawInsert       | shared          | exclusive       |
| insert          | shared          | exclusive       |
| rawDelete       | shared          | exclusive       |
| delete          | shared          | exclusive       |
| rawUpdate       | shared          | exclusive       |
| update          | shared          | exclusive       |
| query           | none            | shared          |
| queryEntries    | none            | shared          |
| rawQuery        | none            | shared          |
| rawQueryEntries | none            | shared          |

| Prepare API | no-transactions | in-transactions |
| ----------- | --------------- | --------------- |
| columns     | none            | none            |
| first       | none            | shared          |
| firstEntry  | none            | shared          |
| all         | none            | shared          |
| allEntries  | none            | shared          |
| execute     | shared          | exclusive       |
| expandSql   | none            | none            |

> In a transaction, Prepare cannot be accessed directly. It needs to be accessed
> through the proxy method provided by transactions to properly handle locks.

## prepare-in-transactions

The prepare method cannot be used directly in the transaction, because these
methods cannot cooperate with the lock inside the transaction

You can use the method function provided by the transaction to delegate access
to the function of prepare, This is the easiest and correct way.

```
  const insert = await db.prepareInsert(table, [columnID, columnName]);
  const insertID = db.prepareLastInsertRowid();
  const query = await db.prepareQuery(table, {
    columns: [columnID, columnName],
  });
  await db.transaction(async (tnx) => {
    for (let i = 1; i < 100; i++) {
      await tnx.method(insert, Method.execute, {
        args: [i, `name-${i}`],
      });
      const id = await tnx.method(insertID, Method.first);
      console.log(`insertID: ${id}`);
    }
    const rows = await tnx.method(query, Method.allEntries);

    console.log(rows);
  });
```

Another approach is to put prepare in the batch created by the transaction,
because the batch of the transaction can communicate correctly with the lock of
the transaction

```
 const insert = await db.prepareInsert(table, [columnID, columnName]);
  const insertID = db.prepareLastInsertRowid();
  const query = await db.prepareQuery(table, {
    columns: [columnID, columnName],
  });
  await db.transaction(async (tnx) => {
    const batch = tnx.batch();
    for (let i = 1; i < 100; i++) {
      batch.method(insert, Method.execute, {
        args: [i, `name-${i}`],
      });
      batch.method(insertID, Method.first, {
        name: `insert-${i}`,
      });
    }
    batch.method(query, Method.allEntries, {
      name: "query",
    });
    await batch.commit();

    for (let i = 1; i < 100; i++) {
      const id = batch.get<Row[]>(`insert-${i}`)![0];
      console.log(`insertID: ${id}`);
    }

    const rows = batch.get<RowObject[]>("query");
    console.log(rows);
  });
```

## context

All asynchronous APIs support an optional parameter Context.

Context is ported from golang. The concept is similar to that in golang. Using
it, it is easy to set timeout or cancel for the request, and it is also easy to
cooperate with golang chan. context and chan are provided by
[easyts](https://deno.land/x/easyts)

```
import { DB, } from "https://deno.land/x/sqlite_async/mod.ts"
import { background } from "https://deno.land/x/sqlite_async/deps/easyts/context/mod.ts"

// open db
const db = await DB.open("test.db");

try {
    const rows = await db.queryEntries("people", {
        ctx: background().withTimeout(100),// timeout 100ms
    })
    console.log(rows)
} finally {
    db.close();
}
```

# rawdb

class RawDB doesn't provide any advanced functionality, it just provides support
for communicating with [x/sqlite](https://deno.land/x/sqlite) in web workers
