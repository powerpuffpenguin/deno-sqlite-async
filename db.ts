// deno-lint-ignore-file no-explicit-any
import {
  ColumnName,
  QueryParameterSet,
  Row,
  RowObject,
  SqliteError,
} from "./sqlite.ts";
import { RawDB, RawOpenOptions, RawPrepared } from "./raw.ts";

import { InvokeOptions, Method, What } from "./caller.ts";
import {
  DeleteOptions,
  ExecuteOptions,
  InsertOptions,
  Locker,
  Options,
  QueryOptions,
  UpdateOptions,
} from "./executor.ts";
import { Locked, RW } from "./internal/rw.ts";
import { Context } from "./deps/easyts/context/mod.ts";
import { Builder } from "./builder.ts";
import { log } from "./log.ts";
import { ArgsOptions, ContextOptions } from "./options.ts";

export interface OpenOptions extends RawOpenOptions {
  /**
   * current db version
   */
  version?: number;
  /**
   * Display the executed sql statement
   */
  showSQL?: boolean;
}
export class _Executor {
  rw: RW;
  constructor(readonly db: RawDB, public showSQL: boolean) {
    this.rw = new RW(db.done());
  }
  private _locked(
    lock: Locker,
    ctx: Context | undefined,
  ): Promise<Locked> | undefined {
    switch (lock) {
      case Locker.shared:
        return this.rw.readLock(ctx);
      case Locker.exclusive:
        return this.rw.lock(ctx);
    }
  }
  private _log(used: number, sql: string, args?: QueryParameterSet) {
    if (this.showSQL) {
      if (args === undefined) {
        log.log(sql, "--", `${used}ms`);
      } else {
        log.log(sql, " --", args, `${used}ms`);
      }
    }
  }
  async execute(lock: Locker, sql: string, opts?: ArgsOptions): Promise<void> {
    const locked = await this._locked(lock, opts?.ctx);
    const at = Date.now();
    try {
      await this.db.execute(sql, opts);
    } finally {
      locked?.unlock();
      this._log(Date.now() - at, sql, opts?.args);
    }
  }
  async query(
    lock: Locker,
    sql: string,
    opts?: ArgsOptions,
  ): Promise<Array<Row>> {
    const locked = await this._locked(lock, opts?.ctx);
    const at = Date.now();
    try {
      return await this.db.query(sql, opts);
    } finally {
      locked?.unlock();
      this._log(Date.now() - at, sql, opts?.args);
    }
  }
  async queryEntries(
    lock: Locker,
    sql: string,
    opts?: ArgsOptions,
  ): Promise<Array<RowObject>> {
    const locked = await this._locked(lock, opts?.ctx);
    const at = Date.now();
    try {
      return await this.db.queryEntries(sql, opts);
    } finally {
      locked?.unlock();
      this._log(Date.now() - at, sql, opts?.args);
    }
  }
  async insert(
    lock: Locker,
    sql: string,
    opts?: ArgsOptions,
  ): Promise<number | bigint> {
    const locked = await this._locked(lock, opts?.ctx);
    const at = Date.now();
    try {
      const rows = await this.db.batch({
        ctx: opts?.ctx,
        savepoint: true,
        batch: [
          {
            sql: sql,
            args: opts?.args,
          },
          {
            sql: "SELECT last_insert_rowid()",
            result: true,
          },
        ],
      });
      const row = rows[0].sql![0];
      return row[0] as number;
    } finally {
      locked?.unlock();
      this._log(Date.now() - at, sql, opts?.args);
    }
  }
  async changes(
    lock: Locker,
    sql: string,
    opts?: ArgsOptions,
  ): Promise<number | bigint> {
    const locked = await this._locked(lock, opts?.ctx);
    const at = Date.now();
    try {
      const rows = await this.db.batch({
        ctx: opts?.ctx,
        savepoint: true,
        batch: [
          {
            sql: sql,
            args: opts?.args,
          },
          {
            sql: "SELECT changes()",
            result: true,
          },
        ],
      });
      const row = rows[0].sql![0];
      return row[0] as number;
    } finally {
      locked?.unlock();
      this._log(Date.now() - at, sql, opts?.args);
    }
  }
  async prepare(sql: string, opts?: ContextOptions): Promise<Prepared> {
    const prepare = await this.db.prepare(sql, opts);
    return new Prepared(this, prepare);
  }
  async invoke(lock: Locker, opts: InvokeOptions) {
    const locked = await this._locked(lock, opts.ctx);
    try {
      return await this.db.invoke(opts);
    } finally {
      locked?.unlock();
    }
  }
}

export class DB {
  static async open(
    path = ":memory:",
    opts?: OpenOptions,
  ): Promise<DB> {
    const version = opts?.version ?? 0;
    if (!Number.isSafeInteger(version) || version < 0) {
      throw new SqliteError(`db version '${version}' not supported`);
    }
    const rawdb = await RawDB.open(path, opts);
    const db = new DB(new _Executor(rawdb, opts?.showSQL ?? false));

    return db;
  }
  get db() {
    return this.er_.db;
  }
  constructor(private readonly er_: _Executor) {}
  get showSQL(): boolean {
    return this.er_.showSQL;
  }
  set showSQL(ok: boolean) {
    this.er_.showSQL = ok;
  }
  get path(): string {
    return this.er_.db.path;
  }
  get isOpen(): boolean {
    return !this.er_.db.isClosed;
  }
  get isClosed(): boolean {
    return this.er_.db.isClosed;
  }
  close() {
    return this.er_.db.close();
  }
  /**
   * Execute an SQL query with no return value.
   *
   * ```
   * await db.execute(
   *    'CREATE TABLE Test (id INTEGER PRIMARY KEY, name TEXT, value INTEGER, num REAL)');
   * ```
   */
  execute(sql: string, opts?: ExecuteOptions): Promise<void> {
    return this.er_.execute(opts?.lock ?? Locker.shared, sql, {
      ctx: opts?.ctx,
      args: opts?.args,
    });
  }
  /**
   * Executes a raw SQL INSERT query and returns the last inserted row ID.
   * ```
   * const id1 = await database.rawInsert(
   *    'INSERT INTO Test(name, value, num) VALUES("some name", 1234, 456.789)');
   * ```
   *
   * 0 could be returned for some specific conflict algorithms if not inserted.
   */
  rawInsert(
    sql: string,
    opts?: ExecuteOptions,
  ): Promise<number | bigint> {
    return this.er_.insert(
      opts?.lock ?? Locker.shared,
      sql,
      {
        ctx: opts?.ctx,
        args: opts?.args,
      },
    );
  }
  /**
   * This method helps insert a map of [values]
   * into the specified [table] and returns the
   * id of the last inserted row.
   *
   * ```
   *    const value = {
   *      'age': 18,
   *      'name': 'value'
   *    };
   *    const id = await db.insert(
   *      'table',
   *      value,
   *      conflictAlgorithm: ConflictAlgorithm.replace,
   *    );
   * ```
   * 0 could be returned for some specific conflict algorithms if not inserted.
   */
  insert(
    table: string,
    values: Record<string, any>,
    opts?: InsertOptions,
  ): Promise<number | bigint> {
    const builder = new Builder();
    builder.insert(table, values, opts?.conflict);
    return this.er_.insert(
      opts?.lock ?? Locker.shared,
      builder.sql(),
      {
        ctx: opts?.ctx,
        args: builder.args(),
      },
    );
  }
  /**
   * Executes a raw SQL SELECT query and returns a list
   * of the rows that were found.
   *
   * ```
   * const rows = await database.rawQuery('SELECT * FROM Test');
   * ```
   */
  rawQuery(
    sql: string,
    opts?: ExecuteOptions,
  ): Promise<Array<RowObject>> {
    return this.er_.queryEntries(
      opts?.lock ?? Locker.shared,
      sql,
      {
        ctx: opts?.ctx,
        args: opts?.args,
      },
    );
  }
  /**
   * This is a helper to query a table and return the items found. All optional
   * clauses and filters are formatted as SQL queries
   * excluding the clauses' names.
   *
   * ```
   *  const rows = await db.query(tableTodo, {
   *      columns: ['columnId', 'columnDone', 'columnTitle'],
   *      where: 'columnId = ?',
   *      args: [id]
   *  });
   * ```
   */
  query(
    table: string,
    opts?: QueryOptions,
  ): Promise<Array<RowObject>> {
    const builder = new Builder();
    builder.query(table, opts);
    return this.er_.queryEntries(
      opts?.lock ?? Locker.shared,
      builder.sql(),
      {
        ctx: opts?.ctx,
        args: builder.args(),
      },
    );
  }
  /**
   * Executes a raw SQL UPDATE query and returns
   * the number of changes made.
   *
   * ```
   * int count = await database.rawUpdate(
   *   'UPDATE Test SET name = ?, value = ? WHERE name = ?', {
   *   args: ['updated name', '9876', 'some name']});
   * ```
   */
  rawUpdate(sql: string, opts?: ExecuteOptions): Promise<number | BigInt> {
    return this.er_.changes(
      opts?.lock ?? Locker.shared,
      sql,
      {
        ctx: opts?.ctx,
        args: opts?.args,
      },
    );
  }
  /**
   * Convenience method for updating rows in the database. Returns
   * the number of changes made
   *
   * Update [table] with [values], a map from column names to new column
   * values. null is a valid value that will be translated to NULL.
   *
   * ```
   * const count = await db.update(tableTodo, todo.toMap(), {
   *    where: `${columnId} = ?`, args: [todo.id]});
   * ```
   */
  update(
    table: string,
    values: Record<string, any>,
    opts?: UpdateOptions,
  ): Promise<number | BigInt> {
    const builder = new Builder();
    builder.update(table, values, opts);
    return this.er_.changes(
      opts?.lock ?? Locker.shared,
      builder.sql(),
      {
        ctx: opts?.ctx,
        args: builder.args(),
      },
    );
  }
  /**
   * Executes a raw SQL DELETE query and returns the
   * number of changes made.
   *
   * ```
   * const count = await db
   *   .rawDelete('DELETE FROM Test WHERE name = ?', {args: ['another name']});
   * ```
   */
  rawDelete(sql: string, opts?: ExecuteOptions): Promise<number | bigint> {
    return this.er_.changes(
      opts?.lock ?? Locker.shared,
      sql,
      {
        ctx: opts?.ctx,
        args: opts?.args,
      },
    );
  }
  /**
   * Convenience method for deleting rows in the database.
   *
   * Delete from [table]
   *
   * You may include ?s in the where clause, which will be replaced by the
   * values from [args]
   *
   * Returns the number of rows affected.
   * ```
   *  const count = await db.delete(tableTodo, {where: 'columnId = ?', args: [id]});
   * ```
   */
  delete(table: string, opts?: DeleteOptions): Promise<number | bigint> {
    const builder = new Builder();
    builder.delete(table, opts);
    return this.er_.changes(
      opts?.lock ?? Locker.shared,
      builder.sql(),
      {
        ctx: opts?.ctx,
        args: builder.args(),
      },
    );
  }
  prepare(sql: string, opts?: ContextOptions): Promise<Prepared> {
    return this.er_.prepare(sql, opts);
  }
}

export class Prepared {
  constructor(
    private readonly er_: _Executor,
    private readonly prepare_: RawPrepared,
  ) {
  }
  close() {
    this.prepare_.close();
  }
  columns(opts?: Options): Promise<Array<ColumnName>> {
    const prepare = this.prepare_;
    if (prepare.isClosed) {
      throw new SqliteError(`Prepared(${prepare.id}) already closed`);
    }
    return this.er_.invoke(opts?.lock ?? Locker.shared, {
      ctx: opts?.ctx,
      req: {
        what: What.method,
        sql: prepare.id,
        method: Method.columns,
        result: true,
      },
    });
  }
  // first(opts?: RawOptions): Promise<Row | undefined> {
  //   const id = this.id_;
  //   if (id == undefined) {
  //     throw new SqliteError(`Prepared(${this.id}) already closed`);
  //   }
  //   return this.caller_.invoke(opts?.ctx, {
  //     what: What.method,
  //     sql: id,
  //     method: Method.first,
  //     args: opts?.args,
  //     result: true,
  //   });
  // }
  // firstEntry(
  //   opts?: RawOptions,
  // ): Promise<RowObject | undefined> {
  //   const id = this.id_;
  //   if (id == undefined) {
  //     throw new SqliteError(`Prepared(${this.id}) already closed`);
  //   }
  //   return this.caller_.invoke(opts?.ctx, {
  //     what: What.method,
  //     sql: id,
  //     method: Method.firstEntry,
  //     args: opts?.args,
  //     result: true,
  //   });
  // }
  // all(
  //   opts?: RawOptions,
  // ): Promise<Array<Row>> {
  //   const id = this.id_;
  //   if (id == undefined) {
  //     throw new SqliteError(`Prepared(${this.id}) already closed`);
  //   }
  //   return this.caller_.invoke(opts?.ctx, {
  //     what: What.method,
  //     sql: id,
  //     method: Method.all,
  //     args: opts?.args,
  //     result: true,
  //   });
  // }
  // allEntries(
  //   opts?: RawOptions,
  // ): Promise<Array<RowObject>> {
  //   const id = this.id_;
  //   if (id == undefined) {
  //     throw new SqliteError(`Prepared(${this.id}) already closed`);
  //   }
  //   return this.caller_.invoke(opts?.ctx, {
  //     what: What.method,
  //     sql: id,
  //     method: Method.allEntries,
  //     args: opts?.args,
  //     result: true,
  //   });
  // }
  // execute(
  //   opts?: RawOptions,
  // ): Promise<undefined> {
  //   const id = this.id_;
  //   if (id == undefined) {
  //     throw new SqliteError(`Prepared(${this.id}) already closed`);
  //   }
  //   return this.caller_.invoke(opts?.ctx, {
  //     what: What.method,
  //     sql: id,
  //     method: Method.execute,
  //     args: opts?.args,
  //   });
  // }
  // expandSql(
  //   opts?: RawOptions,
  // ): Promise<string> {
  //   const id = this.id_;
  //   if (id == undefined) {
  //     throw new SqliteError(`Prepared(${this.id}) already closed`);
  //   }
  //   return this.caller_.invoke(opts?.ctx, {
  //     what: What.method,
  //     sql: id,
  //     method: Method.expandSql,
  //     args: opts?.args,
  //     result: true,
  //   });
  // }
  // async batch(methods: Array<BatchMethod>, opts?: PreparedOptions) {
  //   const id = this.id_;
  //   if (id == undefined) {
  //     throw new SqliteError(`Prepared(${this.id}) already closed`);
  //   }
  //   let result: boolean | undefined;
  //   for (const method of methods) {
  //     if (method.result) {
  //       result = true;
  //       break;
  //     }
  //   }
  //   const batch: Array<RawBatch> = [{
  //     sql: id,
  //     result: result,
  //     methods: methods,
  //   }];
  //   return await this.caller_.invoke(
  //     opts?.ctx,
  //     {
  //       what: What.batch,
  //       batch: batch,
  //     },
  //   );
  // }
}
