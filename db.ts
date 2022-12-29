// deno-lint-ignore-file no-explicit-any
import {
  ColumnName,
  QueryParameterSet,
  Row,
  RowObject,
  SqliteError,
} from "./sqlite.ts";
import {
  RawBatch,
  RawBatchOptions,
  RawBatchResult,
  RawDB,
  RawOpenOptions,
  RawPrepared,
} from "./raw.ts";

import { InvokeOptions, Method, What } from "./caller.ts";
import {
  BatchArgs,
  BatchCommit,
  BatchDeleteArgs,
  BatchExecuteArgs,
  BatchExecutor,
  BatchInsertArgs,
  BatchNameArgs,
  BatchPrepareDeleteArgs,
  BatchPrepareInsertArgs,
  BatchPrepareQueryArgs,
  BatchPrepareUpdateArgs,
  BatchQueryArgs,
  BatchResult,
  BatchUpdateArgs,
  BatchValue,
  DeleteOptions,
  ExecuteOptions,
  Executor,
  InsertOptions,
  Locker,
  Options,
  PrepareDeleteOptions,
  PrepareInsertOptions,
  PrepareQueryOptions,
  PrepareUpdateOptions,
  Preparor,
  QueryOptions,
  UpdateOptions,
} from "./executor.ts";
import { Locked, RW } from "./internal/rw.ts";
import { Context } from "./deps/easyts/context/mod.ts";
import { Builder, ColumnVar, PrepareBuilder } from "./builder.ts";
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
  lastInsertRowid_: RawPrepared | undefined;
  changes_: RawPrepared | undefined;
  async init() {
    const result = await this.db.batch({
      savepoint: true,
      batch: [
        {
          sql: "SELECT last_insert_rowid()",
          result: true,
          prepare: true,
        },
        {
          sql: "SELECT changes()",
          result: true,
          prepare: true,
        },
      ],
    });
    this.lastInsertRowid_ = result[0].prepared;
    this.changes_ = result[1].prepared;
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
  private _log(at: number | undefined, sql: string, args?: QueryParameterSet) {
    if (at === undefined) {
      return;
    }
    const used = Date.now() - at;
    if (args === undefined) {
      log.log(sql, "--", `${used}ms`);
    } else {
      log.log(sql, " --", args, `${used}ms`);
    }
  }
  async execute(lock: Locker, sql: string, opts?: ArgsOptions): Promise<void> {
    const at = this.showSQL ? Date.now() : undefined;
    const locked = await this._locked(lock, opts?.ctx);
    try {
      await this.db.execute(sql, opts);
    } finally {
      locked?.unlock();
      this._log(at, sql, opts?.args);
    }
  }
  async query(
    lock: Locker,
    sql: string,
    opts?: ArgsOptions,
  ): Promise<Array<Row>> {
    const at = this.showSQL ? Date.now() : undefined;
    const locked = await this._locked(lock, opts?.ctx);
    try {
      return await this.db.query(sql, opts);
    } finally {
      locked?.unlock();
      this._log(at, sql, opts?.args);
    }
  }
  async queryEntries(
    lock: Locker,
    sql: string,
    opts?: ArgsOptions,
  ): Promise<Array<RowObject>> {
    const at = this.showSQL ? Date.now() : undefined;
    const locked = await this._locked(lock, opts?.ctx);
    try {
      return await this.db.queryEntries(sql, opts);
    } finally {
      locked?.unlock();
      this._log(at, sql, opts?.args);
    }
  }
  async insert(
    lock: Locker,
    sql: string,
    opts?: ArgsOptions,
  ): Promise<number | bigint> {
    const at = this.showSQL ? Date.now() : undefined;
    const locked = await this._locked(lock, opts?.ctx);
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
            sql: this.lastInsertRowid_!.id,
            method: Method.first,
            result: true,
          },
        ],
      });
      const row = rows[0].prepare as Array<number>;
      return row[0];
    } finally {
      locked?.unlock();
      this._log(at, sql, opts?.args);
    }
  }
  async changes(
    lock: Locker,
    sql: string,
    opts?: ArgsOptions,
  ): Promise<number | bigint> {
    const at = this.showSQL ? Date.now() : undefined;
    const locked = await this._locked(lock, opts?.ctx);
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
            sql: this.changes_!.id,
            method: Method.first,
            result: true,
          },
        ],
      });
      const row = rows[0].prepare as Array<number>;
      return row[0] as number;
    } finally {
      locked?.unlock();
      this._log(at, sql, opts?.args);
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
  async batch(
    lock: Locker,
    opts: RawBatchOptions,
    sqls: Array<{
      sql: string;
      args?: QueryParameterSet;
    }>,
  ): Promise<Array<RawBatchResult>> {
    const at = this.showSQL ? Date.now() : undefined;
    const locked = await this._locked(lock, opts.ctx);
    try {
      return await this.db.batch(opts);
    } finally {
      locked?.unlock();
      if (at !== undefined) {
        const used = Date.now() - at;
        for (const { sql, args } of sqls) {
          if (args === undefined) {
            log.log("batch:", sql);
          } else {
            log.log("batch:", sql, " --", args);
          }
        }
        log.log("batch used:", `${used}ms`);
      }
    }
  }
}
export class SqlPrepare {
  constructor(protected readonly er_: _Executor) {}
  prepare(sql: string, opts?: ContextOptions): Promise<Prepared> {
    return this.er_.prepare(sql, opts);
  }
  prepareChanges(): Prepared {
    const er = this.er_;
    return new Prepared(er, er.changes_!);
  }
  prepareLastInsertRowid(): Prepared {
    const er = this.er_;
    return new Prepared(er, er.lastInsertRowid_!);
  }
  prepareInsert(
    table: string,
    columns: Array<string> | Array<ColumnVar>,
    opts?: PrepareInsertOptions,
  ) {
    const builder = new PrepareBuilder();
    builder.insert(table, columns, opts?.conflict);
    return this.er_.prepare(builder.sql(), opts);
  }
  prepareQuery(table: string, opts?: PrepareQueryOptions) {
    const builder = new PrepareBuilder();
    builder.query(table, opts);
    return this.er_.prepare(builder.sql(), opts);
  }
  prepareUpdate(
    table: string,
    columns: Array<string> | Array<ColumnVar>,
    opts?: PrepareUpdateOptions,
  ) {
    const builder = new PrepareBuilder();
    builder.update(table, columns, opts);
    return this.er_.prepare(builder.sql(), opts);
  }
  prepareDelete(
    table: string,
    opts?: PrepareDeleteOptions,
  ) {
    const builder = new PrepareBuilder();
    builder.delete(table, opts);
    return this.er_.prepare(builder.sql(), opts);
  }
}
export class DB extends SqlPrepare implements Executor {
  static async open(
    path = ":memory:",
    opts?: OpenOptions,
  ): Promise<DB> {
    const version = opts?.version ?? 0;
    if (!Number.isSafeInteger(version) || version < 0) {
      throw new SqliteError(`db version '${version}' not supported`);
    }
    const rawdb = await RawDB.open(path, opts);
    const er = new _Executor(rawdb, opts?.showSQL ?? false);
    try {
      await er.init();
    } catch (e) {
      rawdb.close();
      throw e;
    }
    const db = new DB(er);

    return db;
  }
  get db() {
    return this.er_.db;
  }
  constructor(er: _Executor) {
    super(er);
  }
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
  rawUpdate(sql: string, opts?: ExecuteOptions): Promise<number | bigint> {
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
  ): Promise<number | bigint> {
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
  batch() {
    return new Batch(this.er_);
  }
}

export class Prepared implements Preparor {
  constructor(
    private readonly er_: _Executor,
    private readonly prepared_: RawPrepared,
  ) {
  }
  private closed_ = false;
  close(): boolean {
    if (this.closed_) {
      return false;
    }
    this.closed_ = true;
    const er = this.er_;
    const prepared = this.prepared_;
    if (prepared != er.lastInsertRowid_ && prepared != er.changes_) {
      this.prepared_.close();
    }
    return true;
  }
  get id(): number {
    return this.prepared_.id;
  }
  get sql(): string {
    return this.prepared_.sql;
  }
  get isClosed(): boolean {
    return this.closed_ || this.prepared_.isClosed;
  }
  columns(opts?: Options): Promise<Array<ColumnName>> {
    const prepare = this.prepared_;
    if (prepare.isClosed) {
      throw new SqliteError(`Prepared(${prepare.id}) already closed`);
    }
    return this.er_.invoke(opts?.lock ?? Locker.none, {
      ctx: opts?.ctx,
      req: {
        what: What.method,
        sql: prepare.id,
        method: Method.columns,
        result: true,
      },
    });
  }
  first(opts?: ExecuteOptions): Promise<Row | undefined> {
    const prepare = this.prepared_;
    if (prepare.isClosed) {
      throw new SqliteError(`Prepared(${prepare.id}) already closed`);
    }
    return this.er_.invoke(opts?.lock ?? Locker.shared, {
      ctx: opts?.ctx,
      req: {
        what: What.method,
        sql: prepare.id,
        method: Method.first,
        args: opts?.args,
        result: true,
      },
    });
  }
  firstEntry(
    opts?: ExecuteOptions,
  ): Promise<RowObject | undefined> {
    const prepare = this.prepared_;
    if (prepare.isClosed) {
      throw new SqliteError(`Prepared(${prepare.id}) already closed`);
    }
    return this.er_.invoke(opts?.lock ?? Locker.shared, {
      ctx: opts?.ctx,
      req: {
        what: What.method,
        sql: prepare.id,
        method: Method.firstEntry,
        args: opts?.args,
        result: true,
      },
    });
  }
  all(
    opts?: ExecuteOptions,
  ): Promise<Array<Row>> {
    const prepare = this.prepared_;
    if (prepare.isClosed) {
      throw new SqliteError(`Prepared(${prepare.id}) already closed`);
    }
    return this.er_.invoke(opts?.lock ?? Locker.shared, {
      ctx: opts?.ctx,
      req: {
        what: What.method,
        sql: prepare.id,
        method: Method.all,
        args: opts?.args,
        result: true,
      },
    });
  }
  allEntries(
    opts?: ExecuteOptions,
  ): Promise<Array<RowObject>> {
    const prepare = this.prepared_;
    if (prepare.isClosed) {
      throw new SqliteError(`Prepared(${prepare.id}) already closed`);
    }
    return this.er_.invoke(opts?.lock ?? Locker.shared, {
      ctx: opts?.ctx,
      req: {
        what: What.method,
        sql: prepare.id,
        method: Method.allEntries,
        args: opts?.args,
        result: true,
      },
    });
  }
  execute(
    opts?: ExecuteOptions,
  ): Promise<undefined> {
    const prepare = this.prepared_;
    if (prepare.isClosed) {
      throw new SqliteError(`Prepared(${prepare.id}) already closed`);
    }
    return this.er_.invoke(opts?.lock ?? Locker.shared, {
      ctx: opts?.ctx,
      req: {
        what: What.method,
        sql: prepare.id,
        method: Method.execute,
        args: opts?.args,
      },
    });
  }
  expandSql(
    opts?: ExecuteOptions,
  ): Promise<string> {
    const prepare = this.prepared_;
    if (prepare.isClosed) {
      throw new SqliteError(`Prepared(${prepare.id}) already closed`);
    }
    return this.er_.invoke(opts?.lock ?? Locker.shared, {
      ctx: opts?.ctx,
      req: {
        what: What.method,
        sql: prepare.id,
        method: Method.expandSql,
        args: opts?.args,
        result: true,
      },
    });
  }
}

export class Batch implements BatchExecutor {
  private hook_ = new Set<number>();
  private prepare_ = new Set<number>();
  private i_ = 0;
  private batch_ = new Array<RawBatch>();
  private keys_?: Map<number, string>;
  private values_?: Map<string, BatchValue>;
  private sqls_ = new Array<{
    sql: string;
    args?: QueryParameterSet;
  }>();
  constructor(private er_: _Executor) {}
  private lock_ = Locker.none;
  values() {
    return this.values_;
  }
  async commit(opts?: BatchCommit): Promise<Array<BatchResult>> {
    const batch = this.batch_;
    if (batch.length == 0) {
      return [];
    }
    const rows = await this.er_.batch(
      opts?.lock ?? this.lock_,
      {
        ctx: opts?.ctx,
        savepoint: opts?.savepoint,
        batch: batch,
      },
      this.sqls_,
    );
    for (const i of this.hook_) {
      const row = rows[i].prepare as Array<any>;
      rows[i].sql = row[0];
      rows[i].prepare = undefined;
    }
    for (const i of this.prepare_) {
      const prepared = rows[i].prepared!;
      rows[i].prepared = new Prepared(this.er_, prepared) as any;
    }
    const keys = this.keys_;
    if (keys && keys.size != 0) {
      const values = new Map<string, any>();
      const end = rows.length;
      for (let i = 0; i < end; i++) {
        const name = keys.get(i);
        if (name === undefined) {
          continue;
        }
        const row = rows[i];
        if (row.sql !== undefined) {
          values.set(name, row.sql);
        } else if (row.prepare !== undefined) {
          values.set(name, row.prepare);
        } else if (row.prepared !== undefined) {
          values.set(name, row.prepared);
        }
      }
      this.values_ = values;
    } else {
      this.values_ = undefined;
    }
    return rows;
  }
  private _name(name?: string) {
    if (name !== undefined && name !== null) {
      let keys = this.keys_;
      if (keys) {
        keys.set(this.i_, name);
      } else {
        keys = new Map<number, string>();
        keys.set(this.i_, name);
        this.keys_ = keys;
      }
    }
  }
  execute(sql: string, opts?: BatchExecuteArgs): void {
    if (opts?.result) {
      this._name(opts?.name);
      this.i_++;
    }
    this.batch_.push(
      {
        sql: sql,
        args: opts?.args,
        result: opts?.result,
      },
    );

    this.sqls_.push({
      sql: sql,
      args: opts?.args,
    });
    this.lock_ = Locker.shared;
  }
  rawInsert(sql: string, opts?: BatchArgs): void {
    this._name(opts?.name);
    this.hook_.add(this.i_++);

    this.batch_.push(
      {
        sql: sql,
        args: opts?.args,
      },
      {
        sql: this.er_.lastInsertRowid_!.id,
        method: Method.first,
        result: true,
      },
    );

    this.sqls_.push({
      sql: sql,
      args: opts?.args,
    });
    this.lock_ = Locker.shared;
  }
  insert(
    table: string,
    values: Record<string, any>,
    opts?: BatchInsertArgs,
  ): void {
    const builder = new Builder();
    builder.insert(table, values, opts?.conflict);

    this.rawInsert(builder.sql(), {
      name: opts?.name,
      args: builder.args(),
    });
  }
  private _change(sql: string, opts?: BatchArgs): void {
    this._name(opts?.name);
    this.hook_.add(this.i_++);

    this.batch_.push(
      {
        sql: sql,
        args: opts?.args,
      },
      {
        sql: this.er_.changes_!.id,
        method: Method.first,
        result: true,
      },
    );

    this.sqls_.push({
      sql: sql,
      args: opts?.args,
    });
    this.lock_ = Locker.shared;
  }
  rawDelete(sql: string, opts?: BatchArgs): void {
    this._change(sql, opts);
  }

  delete(table: string, opts?: BatchDeleteArgs): void {
    const builder = new Builder();
    builder.delete(table, opts);
    this._change(builder.sql(), {
      name: opts?.name,
      args: builder.args(),
    });
  }

  rawUpdate(sql: string, opts?: BatchArgs): void {
    this._change(sql, opts);
  }
  update(
    table: string,
    values: Record<string, any>,
    opts?: BatchUpdateArgs,
  ): void {
    const builder = new Builder();
    builder.update(table, values, opts);
    this._change(builder.sql(), {
      name: opts?.name,
      args: builder.args(),
    });
  }

  rawQuery(sql: string, opts?: BatchArgs): void {
    this._name(opts?.name);
    this.i_++;
    this.batch_.push(
      {
        sql: sql,
        args: opts?.args,
        result: true,
        entries: true,
      },
    );

    this.sqls_.push({
      sql: sql,
      args: opts?.args,
    });
    this.lock_ = Locker.shared;
  }

  query(table: string, opts?: BatchQueryArgs): void {
    const builder = new Builder();
    builder.query(table, opts);
    const sql = builder.sql();
    const args = builder.args();

    this._name(opts?.name);
    this.i_++;
    this.batch_.push(
      {
        sql: sql,
        args: args,
        result: true,
        entries: true,
      },
    );

    this.sqls_.push({
      sql: sql,
      args: args,
    });
    this.lock_ = Locker.shared;
  }

  prepare(sql: string, opts?: BatchNameArgs): void {
    this._name(opts?.name);
    this.prepare_.add(this.i_++);
    this.batch_.push({
      sql: sql,
      prepare: true,
    });
  }
  prepareInsert(
    table: string,
    columns: Array<string> | Array<ColumnVar>,
    opts?: BatchPrepareInsertArgs,
  ): void {
    const builder = new PrepareBuilder();
    builder.insert(table, columns, opts?.conflict);
    this.prepare(builder.sql(), opts);
  }
  prepareDelete(
    table: string,
    opts?: BatchPrepareDeleteArgs,
  ): void {
    const builder = new PrepareBuilder();
    builder.delete(table, opts);
    this.prepare(builder.sql(), opts);
  }
  prepareUpdate(
    table: string,
    columns: Array<string> | Array<ColumnVar>,
    opts?: BatchPrepareUpdateArgs,
  ): void {
    const builder = new PrepareBuilder();
    builder.update(table, columns, opts);
    this.prepare(builder.sql(), opts);
  }
  prepareQuery(table: string, opts?: BatchPrepareQueryArgs): void {
    const builder = new PrepareBuilder();
    builder.query(table, opts);
    this.prepare(builder.sql(), opts);
  }

  method(
    preparor: Preparor,
    method: Method,
    opts?: BatchArgs,
  ) {
    if (preparor.isClosed) {
      throw new SqliteError(`Preparor(${preparor.id}) already closed`);
    }
    this._name(opts?.name);
    this.i_++;

    this.batch_.push({
      sql: preparor.id,
      args: opts?.args,
      method: method,
      result: true,
    });

    switch (method) {
      case Method.first:
      case Method.firstEntry:
      case Method.all:
      case Method.allEntries:
      case Method.execute:
        this.sqls_.push({
          sql: preparor.sql,
          args: opts?.args,
        });
        break;
    }

    if (method != Method.expandSql && method != Method.columns) {
      this.lock_ = Locker.shared;
    }
  }
}
