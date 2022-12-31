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

import {
  ArgsOptions,
  InvokeMethod,
  InvokeOptions,
  Method,
  What,
} from "./caller.ts";
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
  ContextArgs,
  CreatorDeleteArgs,
  CreatorInsertArgs,
  CreatorPrepared,
  CreatorQueryArgs,
  CreatorUpdateArgs,
  DeleteArgs,
  ExecuteArgs,
  Executor,
  InsertArgs,
  LockArgs,
  Locker,
  Preparor,
  QueryArgs,
  Transaction,
  TransactionArgs,
  UpdateArgs,
} from "./executor.ts";
import { Locked, RW } from "./internal/rw.ts";
import { Context } from "./deps/easyts/context/mod.ts";
import { Builder, ColumnVar, PrepareBuilder } from "./builder.ts";
import { log } from "./log.ts";

export interface OpenOptions extends RawOpenOptions {
  /**
   * current db version
   */
  version?: number;
  /**
   * Display the executed sql statement
   */
  showSQL?: boolean;

  /**
   * The function that is first called back after the connection is created
   *
   * Called before onCreate/onUpgrade/onDowngrade
   *
   * @param txn Transaction
   */
  onOpen?: (txn: SqlTransaction) => any;

  /**
   * Callback when the database is first created
   * @param txn Transaction
   * @param version database current version
   */
  onCreate?: (txn: SqlTransaction, version: number) => void | Promise<void>;
  /**
   * Callback when the current version is higher than the version recorded in the database
   * @param txn Transaction
   * @param oldVersion version of the record in the database
   * @param newVersion database current version
   */
  onUpgrade?: (
    txn: SqlTransaction,
    oldVersion: number,
    newVersion: number,
  ) => any;
  /**
   * Callback when the current version is lower than the version recorded in the database
   * @param txn Transaction
   * @param oldVersion version of the record in the database
   * @param newVersion database current version
   */
  onDowngrade?: (
    txn: SqlTransaction,
    oldVersion: number,
    newVersion: number,
  ) => any;

  /**
   * Callback when everything is ready
   *
   * Called after onCreate/onUpgrade/onDowngrade
   * @param txn Transaction
   * @param version database current version
   */
  onReady?: (txn: SqlTransaction, version: number) => any;
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
  private _log(
    at: number | undefined,
    sql: string,
    args?: QueryParameterSet,
    method?: Method,
  ) {
    if (at === undefined) {
      return;
    }
    const used = Date.now() - at;
    if (method !== undefined) {
      sql = `${method}: ${sql}`;
    }
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
  async prepare(sql: string, opts?: ContextArgs): Promise<Prepared> {
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
      method?: Method;
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
        for (const { sql, args, method } of sqls) {
          const prefix = method === undefined ? "batch:" : `batch-${method}:`;
          if (args === undefined) {
            log.log(prefix, sql);
          } else {
            log.log(prefix, sql, " --", args);
          }
        }
        log.log("batch used:", `${used}ms`);
      }
    }
  }
  async method(lock: Locker, opts: InvokeMethod, sql?: string) {
    const at = this.showSQL && sql !== undefined ? Date.now() : undefined;
    const locked = await this._locked(lock, opts.ctx);
    try {
      return await this.db.invoke({
        ctx: opts.ctx,
        req: {
          what: What.method,
          sql: opts.sql,
          args: opts.args,
          method: opts.method,
          result: opts.result,
        },
      });
    } finally {
      locked?.unlock();
      if (at !== undefined) {
        this._log(at, sql!, opts?.args, opts.method);
      }
    }
  }
}
function lockDB(
  _?: Context,
  locker?: Locker,
  write?: boolean,
) {
  if (locker) {
    return locker;
  }
  if (write) {
    return Locker.shared;
  }
  return Locker.none;
}
type LockerFunc = (
  ctx?: Context,
  locker?: Locker,
  write?: boolean,
  read?: boolean,
) => Locker | Promise<Locker>;
class SqlExecutor implements CreatorPrepared, Executor {
  constructor(
    protected readonly er_: _Executor,
    readonly lock_: LockerFunc,
    readonly root?: boolean,
  ) {}
  prepare(sql: string, opts?: ContextArgs): Promise<Prepared> {
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
    opts?: CreatorInsertArgs,
  ) {
    const builder = new PrepareBuilder();
    builder.insert(table, columns, opts?.conflict);
    return this.er_.prepare(builder.sql(), opts);
  }
  prepareDelete(
    table: string,
    opts?: CreatorDeleteArgs,
  ) {
    const builder = new PrepareBuilder();
    builder.delete(table, opts);
    return this.er_.prepare(builder.sql(), opts);
  }
  prepareUpdate(
    table: string,
    columns: Array<string> | Array<ColumnVar>,
    opts?: CreatorUpdateArgs,
  ) {
    const builder = new PrepareBuilder();
    builder.update(table, columns, opts);
    return this.er_.prepare(builder.sql(), opts);
  }
  prepareQuery(table: string, opts?: CreatorQueryArgs) {
    const builder = new PrepareBuilder();
    builder.query(table, opts);
    return this.er_.prepare(builder.sql(), opts);
  }

  async execute(sql: string, opts?: ExecuteArgs): Promise<void> {
    const lock = await this.lock_(opts?.ctx, opts?.lock, true);
    return this.er_.execute(lock, sql, {
      ctx: opts?.ctx,
      args: opts?.args,
    });
  }
  async rawInsert(
    sql: string,
    opts?: ExecuteArgs,
  ): Promise<number | bigint> {
    const lock = await this.lock_(opts?.ctx, opts?.lock, true);
    return this.er_.insert(
      lock,
      sql,
      {
        ctx: opts?.ctx,
        args: opts?.args,
      },
    );
  }
  async insert(
    table: string,
    values: Record<string, any>,
    opts?: InsertArgs,
  ): Promise<number | bigint> {
    const builder = new Builder();
    builder.insert(table, values, opts?.conflict);

    const lock = await this.lock_(opts?.ctx, opts?.lock, true);
    return this.er_.insert(
      lock,
      builder.sql(),
      {
        ctx: opts?.ctx,
        args: builder.args(),
      },
    );
  }
  async rawDelete(sql: string, opts?: ExecuteArgs): Promise<number | bigint> {
    const lock = await this.lock_(opts?.ctx, opts?.lock, true);
    return this.er_.changes(
      lock,
      sql,
      {
        ctx: opts?.ctx,
        args: opts?.args,
      },
    );
  }
  async delete(table: string, opts?: DeleteArgs): Promise<number | bigint> {
    const builder = new Builder();
    builder.delete(table, opts);

    const lock = await this.lock_(opts?.ctx, opts?.lock, true);
    return this.er_.changes(
      lock,
      builder.sql(),
      {
        ctx: opts?.ctx,
        args: builder.args(),
      },
    );
  }
  async rawUpdate(sql: string, opts?: ExecuteArgs): Promise<number | bigint> {
    const lock = await this.lock_(opts?.ctx, opts?.lock, true);
    return this.er_.changes(
      lock,
      sql,
      {
        ctx: opts?.ctx,
        args: opts?.args,
      },
    );
  }
  async update(
    table: string,
    values: Record<string, any>,
    opts?: UpdateArgs,
  ): Promise<number | bigint> {
    const builder = new Builder();
    builder.update(table, values, opts);

    const lock = await this.lock_(opts?.ctx, opts?.lock, true);
    return this.er_.changes(
      lock,
      builder.sql(),
      {
        ctx: opts?.ctx,
        args: builder.args(),
      },
    );
  }
  async rawQuery(
    sql: string,
    opts?: ExecuteArgs,
  ): Promise<Array<Row>> {
    const lock = await this.lock_(opts?.ctx, opts?.lock, undefined, true);
    return this.er_.query(
      lock,
      sql,
      {
        ctx: opts?.ctx,
        args: opts?.args,
      },
    );
  }
  async rawQueryEntries(
    sql: string,
    opts?: ExecuteArgs,
  ): Promise<Array<RowObject>> {
    const lock = await this.lock_(opts?.ctx, opts?.lock, undefined, true);
    return this.er_.queryEntries(
      lock,
      sql,
      {
        ctx: opts?.ctx,
        args: opts?.args,
      },
    );
  }
  async query(
    table: string,
    opts?: QueryArgs,
  ): Promise<Array<Row>> {
    const builder = new Builder();
    builder.query(table, opts);

    const lock = await this.lock_(opts?.ctx, opts?.lock, undefined, true);
    return this.er_.query(
      lock,
      builder.sql(),
      {
        ctx: opts?.ctx,
        args: builder.args(),
      },
    );
  }
  async queryEntries(
    table: string,
    opts?: QueryArgs,
  ): Promise<Array<RowObject>> {
    const builder = new Builder();
    builder.query(table, opts);

    const lock = await this.lock_(opts?.ctx, opts?.lock, undefined, true);
    return this.er_.queryEntries(
      lock,
      builder.sql(),
      {
        ctx: opts?.ctx,
        args: builder.args(),
      },
    );
  }
  batch() {
    return new Batch(this.er_, this.lock_);
  }
  async createSavepoint(name: string, opts?: ContextArgs) {
    const s = new SqlSavepointState(
      this.er_,
      name,
      this.root ? undefined : this.lock_,
    );
    await s.init(opts);
    return new SqlSavepoint(s);
  }

  async savepoint<T>(
    name: string,
    action: (sp: SqlSavepoint) => Promise<T>,
    opts?: ContextArgs,
  ): Promise<T> {
    const s = new SqlSavepointState(
      this.er_,
      name,
      this.root ? undefined : this.lock_,
    );
    await s.init(opts);
    const sp = new SqlSavepoint(s);
    let resp: T;
    try {
      resp = await action(sp);
    } catch (e) {
      await s.rollback();
      throw e;
    }
    await s.commit();
    return resp;
  }

  async method(
    preparor: Preparor,
    method: Method,
    opts?: ExecuteArgs,
  ) {
    if (preparor.isClosed) {
      throw new SqliteError(`Preparor(${preparor.id}) already closed`);
    }
    let write: undefined | boolean;
    let read: undefined | boolean;
    let sql: string | undefined;
    switch (method) {
      case Method.first:
      case Method.firstEntry:
      case Method.all:
      case Method.allEntries:
        read = true;
        sql = preparor.sql;
        break;
      case Method.execute:
        write = true;
        sql = preparor.sql;
        break;
    }
    const lock = await this.lock_(opts?.ctx, opts?.lock, write, read);
    if (preparor.isClosed) {
      throw new SqliteError(`Preparor(${preparor.id}) already closed`);
    }
    return this.er_.method(lock, {
      sql: preparor.id,
      args: opts?.args,
      method: method,
      result: method == Method.execute ? undefined : true,
    }, sql);
  }
}

export class DB extends SqlExecutor {
  static async open(
    path?: string,
    opts?: OpenOptions,
  ): Promise<DB> {
    const version = opts?.version;
    if (typeof version === "number") {
      if (!Number.isSafeInteger(version) || version < 0) {
        throw new SqliteError(`db version '${version}' not supported`);
      }
    }

    const rawdb = await RawDB.open(path, {
      mode: opts?.mode,
      memory: opts?.memory,
      uri: opts?.uri,
      worker: opts?.worker,
      task: opts?.task,
    });
    const er = new _Executor(rawdb, opts?.showSQL ?? false);
    try {
      await er.init();
    } catch (e) {
      rawdb.close();
      throw e;
    }
    const db = new DB(er);
    if (typeof version !== "number") {
      return db;
    }
    try {
      await db.transaction(async (txn) => {
        if (opts?.onOpen) {
          await opts.onOpen(txn);
        }

        const batch = txn.batch();
        batch.execute(
          "CREATE TABLE IF NOT EXISTS web_worker_sqlite_system (id INTEGER PRIMARY KEY, version INTEGER)",
        ).queryEntries("web_worker_sqlite_system", {
          columns: ["version"],
          where: `id = 1`,
        });
        const rows = await batch.commit();
        const row = rows[0].sql! as RowObject[];
        if (row.length == 0) {
          await txn.insert("web_worker_sqlite_system", {
            id: 1,
            version: version,
          });
          if (opts?.onCreate) {
            await opts.onCreate(txn, version);
          }
        } else {
          const val = row[0].version;
          if (val !== version) {
            if (typeof val === "number") {
              if (version > val) {
                await txn.update("web_worker_sqlite_system", {
                  version: version,
                }, {
                  where: "id = 1",
                });
                if (opts?.onUpgrade) {
                  await opts.onUpgrade(txn, val, version);
                }
              } else if (version < val) {
                if (opts?.onDowngrade) {
                  await txn.update("web_worker_sqlite_system", {
                    version: version,
                  }, {
                    where: "id = 1",
                  });
                  await opts.onDowngrade(txn, val, version);
                } else {
                  throw new SqliteError(
                    `version(${val}) is higher than the incoming version(${version}), please set the onDowngrade callback function`,
                  );
                }
              }
            } else {
              await txn.update("web_worker_sqlite_system", {
                version: version,
              }, {
                where: "id = 1",
              });
              if (opts?.onCreate) {
                await opts.onCreate(txn, version);
              }
            }
          }
        }
        if (opts?.onReady) {
          await opts.onReady(txn, version);
        }
      });
    } catch (e) {
      db.close();
      throw e;
    }
    return db;
  }
  get db() {
    return this.er_.db;
  }
  constructor(er: _Executor) {
    super(er, lockDB, true);
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
   * start a transaction
   */
  async begin(opts?: TransactionArgs): Promise<SqlTransaction> {
    const s = new SqlTransactionState(this.er_);
    await s.init(opts);
    return new SqlTransaction(s);
  }
  /**
   * Start a transaction to execute the action function,
   * automatically commit after the function ends,
   * and automatically roll back if the function throws an exception
   */
  async transaction<T>(
    action: (txn: SqlTransaction) => Promise<T>,
    opts?: TransactionArgs,
  ): Promise<T> {
    const s = new SqlTransactionState(this.er_);
    await s.init(opts);
    const txn = new SqlTransaction(s);
    let resp: T;
    try {
      resp = await action(txn);
    } catch (e) {
      await s.rollback();
      throw e;
    }
    await s.commit();
    return resp;
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
  columns(opts?: LockArgs): Promise<Array<ColumnName>> {
    const prepare = this.prepared_;
    if (prepare.isClosed) {
      throw new SqliteError(`Prepared(${prepare.id}) already closed`);
    }
    return this.er_.method(opts?.lock ?? Locker.none, {
      ctx: opts?.ctx,
      sql: prepare.id,
      method: Method.columns,
      result: true,
    });
  }
  first(opts?: ExecuteArgs): Promise<Row | undefined> {
    const prepare = this.prepared_;
    if (prepare.isClosed) {
      throw new SqliteError(`Prepared(${prepare.id}) already closed`);
    }
    return this.er_.method(opts?.lock ?? Locker.none, {
      ctx: opts?.ctx,
      sql: prepare.id,
      args: opts?.args,
      method: Method.first,
      result: true,
    }, this.sql);
  }
  firstEntry(
    opts?: ExecuteArgs,
  ): Promise<RowObject | undefined> {
    const prepare = this.prepared_;
    if (prepare.isClosed) {
      throw new SqliteError(`Prepared(${prepare.id}) already closed`);
    }
    return this.er_.method(opts?.lock ?? Locker.none, {
      ctx: opts?.ctx,
      sql: prepare.id,
      args: opts?.args,
      method: Method.firstEntry,
      result: true,
    }, this.sql);
  }
  all(
    opts?: ExecuteArgs,
  ): Promise<Array<Row>> {
    const prepare = this.prepared_;
    if (prepare.isClosed) {
      throw new SqliteError(`Prepared(${prepare.id}) already closed`);
    }
    return this.er_.method(opts?.lock ?? Locker.none, {
      ctx: opts?.ctx,
      sql: prepare.id,
      args: opts?.args,
      method: Method.all,
      result: true,
    }, this.sql);
  }
  allEntries(
    opts?: ExecuteArgs,
  ): Promise<Array<RowObject>> {
    const prepare = this.prepared_;
    if (prepare.isClosed) {
      throw new SqliteError(`Prepared(${prepare.id}) already closed`);
    }
    return this.er_.method(opts?.lock ?? Locker.none, {
      ctx: opts?.ctx,
      sql: prepare.id,
      args: opts?.args,
      method: Method.allEntries,
      result: true,
    }, this.sql);
  }
  execute(
    opts?: ExecuteArgs,
  ): Promise<undefined> {
    const prepare = this.prepared_;
    if (prepare.isClosed) {
      throw new SqliteError(`Prepared(${prepare.id}) already closed`);
    }
    return this.er_.method(opts?.lock ?? Locker.shared, {
      ctx: opts?.ctx,
      sql: prepare.id,
      args: opts?.args,
      method: Method.execute,
    }, this.sql);
  }
  expandSql(
    opts?: ExecuteArgs,
  ): Promise<string> {
    const prepare = this.prepared_;
    if (prepare.isClosed) {
      throw new SqliteError(`Prepared(${prepare.id}) already closed`);
    }
    return this.er_.method(opts?.lock ?? Locker.none, {
      ctx: opts?.ctx,
      sql: prepare.id,
      args: opts?.args,
      method: Method.expandSql,
      result: true,
    });
  }
}

export class Batch implements BatchExecutor {
  private hook_ = new Set<number>();
  private prepare_ = new Set<number>();
  private i_ = 0;
  private batch_ = new Array<RawBatch>();
  private keys_?: Map<number, string>;
  private names_?: Set<string>;
  private values_?: Map<string, BatchValue>;
  private sqls_ = new Array<{
    sql: string;
    args?: QueryParameterSet;
    method?: Method;
  }>();
  constructor(private er_: _Executor, readonly lock_: LockerFunc) {}
  private read_?: boolean;
  private write_?: boolean;
  values() {
    return this.values_;
  }
  get<T>(name: string): T | undefined {
    return (this.values_?.get(name) ?? undefined) as any;
  }
  async commit(opts?: BatchCommit): Promise<Array<BatchResult>> {
    const batch = this.batch_;
    if (batch.length == 0) {
      return [];
    }
    const lock = await this.lock_(
      opts?.ctx,
      opts?.lock,
      this.write_,
      this.read_,
    );
    const rows = await this.er_.batch(
      lock,
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
        const names = this.names_!;
        if (names.has(name)) {
          throw new SqliteError(`name already exists: ${names}`);
        }
        keys.set(this.i_, name);
        names.add(name);
      } else {
        keys = new Map<number, string>();
        keys.set(this.i_, name);

        const names = new Set<string>();
        names.add(name);

        this.keys_ = keys;
        this.names_ = names;
      }
    }
  }
  execute(sql: string, opts?: BatchExecuteArgs) {
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
    this.write_ = true;
    return this;
  }
  rawInsert(sql: string, opts?: BatchArgs) {
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
    this.write_ = true;
    return this;
  }
  insert(
    table: string,
    values: Record<string, any>,
    opts?: BatchInsertArgs,
  ) {
    const builder = new Builder();
    builder.insert(table, values, opts?.conflict);

    this.rawInsert(builder.sql(), {
      name: opts?.name,
      args: builder.args(),
    });

    return this;
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
    this.write_ = true;
  }
  rawDelete(sql: string, opts?: BatchArgs) {
    this._change(sql, opts);
    return this;
  }

  delete(table: string, opts?: BatchDeleteArgs) {
    const builder = new Builder();
    builder.delete(table, opts);
    this._change(builder.sql(), {
      name: opts?.name,
      args: builder.args(),
    });
    return this;
  }

  rawUpdate(sql: string, opts?: BatchArgs) {
    this._change(sql, opts);
    return this;
  }
  update(
    table: string,
    values: Record<string, any>,
    opts?: BatchUpdateArgs,
  ) {
    const builder = new Builder();
    builder.update(table, values, opts);
    this._change(builder.sql(), {
      name: opts?.name,
      args: builder.args(),
    });
    return this;
  }

  query(table: string, opts?: BatchQueryArgs) {
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
      },
    );

    this.sqls_.push({
      sql: sql,
      args: args,
    });
    this.read_ = true;
    return this;
  }
  rawQuery(sql: string, opts?: BatchArgs) {
    this._name(opts?.name);
    this.i_++;
    this.batch_.push(
      {
        sql: sql,
        args: opts?.args,
        result: true,
      },
    );

    this.sqls_.push({
      sql: sql,
      args: opts?.args,
    });
    this.read_ = true;
    return this;
  }
  queryEntries(table: string, opts?: BatchQueryArgs) {
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
    this.read_ = true;
    return this;
  }
  rawQueryEntries(sql: string, opts?: BatchArgs) {
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
    this.read_ = true;
    return this;
  }
  prepare(sql: string, opts?: BatchNameArgs) {
    this._name(opts?.name);
    this.prepare_.add(this.i_++);
    this.batch_.push({
      sql: sql,
      prepare: true,
      result: true,
    });

    return this;
  }
  prepareInsert(
    table: string,
    columns: Array<string> | Array<ColumnVar>,
    opts?: BatchPrepareInsertArgs,
  ) {
    const builder = new PrepareBuilder();
    builder.insert(table, columns, opts?.conflict);
    this.prepare(builder.sql(), opts);

    return this;
  }
  prepareDelete(
    table: string,
    opts?: BatchPrepareDeleteArgs,
  ) {
    const builder = new PrepareBuilder();
    builder.delete(table, opts);
    this.prepare(builder.sql(), opts);

    return this;
  }
  prepareUpdate(
    table: string,
    columns: Array<string> | Array<ColumnVar>,
    opts?: BatchPrepareUpdateArgs,
  ) {
    const builder = new PrepareBuilder();
    builder.update(table, columns, opts);
    this.prepare(builder.sql(), opts);

    return this;
  }
  prepareQuery(table: string, opts?: BatchPrepareQueryArgs) {
    const builder = new PrepareBuilder();
    builder.query(table, opts);
    this.prepare(builder.sql(), opts);

    return this;
  }

  method(
    preparor: Preparor,
    method: Method,
    opts?: BatchArgs,
  ) {
    if (preparor.isClosed) {
      throw new SqliteError(`Preparor(${preparor.id}) already closed`);
    }

    const result = method == Method.execute ? undefined : true;
    if (result) {
      this._name(opts?.name);
      this.i_++;
    }
    this.batch_.push({
      sql: preparor.id,
      args: opts?.args,
      method: method,
      result: result,
    });

    switch (method) {
      case Method.first:
      case Method.firstEntry:
      case Method.all:
      case Method.allEntries:
        this.sqls_.push({
          sql: preparor.sql,
          args: opts?.args,
          method: method,
        });
        this.read_ = true;
        break;
      case Method.execute:
        this.sqls_.push({
          sql: preparor.sql,
          args: opts?.args,
          method: method,
        });
        this.write_ = true;
        break;
    }
    return this;
  }
}
class SqlTransactionState {
  constructor(readonly er_: _Executor) {}
  private lock_ = Locker.none;
  private locked_?: Locked;
  private begin_ = false;
  closed_ = false;
  async write(ctx?: Context): Promise<Locker.none> {
    if (this.closed_) {
      throw new SqliteError(`Transaction already closed`);
    }
    if (this.lock_ == Locker.none) {
      this.locked_ = await this.er_.rw.lock(ctx);
      this.lock_ = Locker.exclusive;
    } else if (this.lock_ == Locker.shared) {
      const locked = this.locked_!;
      this.locked_ = undefined;
      this.lock_ = Locker.none;
      locked.unlock();

      this.locked_ = await this.er_.rw.lock(ctx);
      this.lock_ = Locker.exclusive;
    }

    if (!this.begin_) {
      await this.er_.invoke(Locker.none, {
        ctx: ctx,
        req: {
          what: What.execute,
          sql: "BEGIN DEFERRED",
        },
      });
      this.begin_ = true;
    }
    return Locker.none;
  }
  async read(ctx?: Context): Promise<Locker.none> {
    if (this.closed_) {
      throw new SqliteError(`Transaction already closed`);
    }

    if (this.lock_ == Locker.none) {
      this.locked_ = await this.er_.rw.readLock(ctx);
      this.lock_ = Locker.shared;
    }
    return Locker.none;
  }
  async rollback() {
    if (this.closed_) {
      throw new SqliteError(`Transaction already closed`);
    }
    this.closed_ = true;
    const er = this.er_;
    if (this.begin_) {
      try {
        await er.execute(Locker.none, "ROLLBACK");
      } catch (_) { //
      } finally {
        this.locked_?.unlock();
      }
      return;
    }
    if (er.showSQL) {
      log.log("ROLLBACK -- 0ms");
    }
    this.locked_?.unlock();
  }
  async commit() {
    if (this.closed_) {
      throw new SqliteError(`Transaction already closed`);
    }
    this.closed_ = true;
    const er = this.er_;
    if (this.begin_) {
      try {
        await er.execute(Locker.none, "COMMIT");
      } finally {
        this.locked_?.unlock();
      }
      return;
    }
    if (er.showSQL) {
      log.log("COMMIT -- 0ms");
    }
    this.locked_?.unlock();
  }
  async init(opts?: TransactionArgs) {
    let lock = opts?.lock ?? Locker.none;
    switch (opts?.type) {
      case "IMMEDIATE":
      case "EXCLUSIVE":
        lock = Locker.exclusive;
        break;
    }

    const er = this.er_;
    const rw = er.rw;
    let locked: undefined | Locked;
    switch (lock) {
      case Locker.exclusive:
        locked = await rw.lock(opts?.ctx);
        break;
      case Locker.shared:
        locked = await rw.readLock(opts?.ctx);
        break;
    }

    switch (opts?.type) {
      case "IMMEDIATE":
      case "EXCLUSIVE":
        try {
          await er.execute(Locker.none, `BEGIN ${opts.type}`);
          this.begin_ = true;
        } catch (e) {
          locked!.unlock();
          throw e;
        }
        break;
      default:
        if (er.showSQL) {
          if (opts?.type) {
            log.log("BEGIN DEFERRED -- 0ms");
          } else {
            log.log("BEGIN -- 0ms");
          }
        }
        break;
    }
    this.lock_ = lock;
    this.locked_ = locked;
  }
}
export class SqlTransaction extends SqlExecutor implements Transaction {
  constructor(private readonly s_: SqlTransactionState) {
    super(s_.er_, (ctx, locker, write, read) => {
      if (s_.closed_) {
        throw new SqliteError(`Transaction already closed`);
      }
      switch (locker) {
        case Locker.exclusive:
          return s_.write(ctx);
        case Locker.shared:
          return s_.read(ctx);
        case Locker.none:
          return Promise.resolve(locker);
      }
      if (write) {
        return s_.write(ctx);
      } else if (read) {
        return s_.read(ctx);
      }
      return Locker.none;
    });
  }
  get isClosed(): boolean {
    return this.s_.closed_;
  }
  rollback() {
    return this.s_.rollback();
  }
  commit() {
    return this.s_.commit();
  }
}
class SqlSavepointState {
  private lock_ = Locker.none;
  private locked_?: Locked;
  private begin_ = false;
  closed_ = false;
  constructor(
    readonly er: _Executor,
    readonly name: string,
    readonly lockf?: LockerFunc,
  ) {}
  lock(ctx?: Context, locker?: Locker, write?: boolean, read?: boolean) {
    if (this.closed_) {
      throw new SqliteError(`Savepoint already closed: ${this.name}`);
    }
    return this._lock(ctx, locker, write, read);
  }
  private _lock(
    ctx?: Context,
    locker?: Locker,
    write?: boolean,
    read?: boolean,
  ) {
    if (this.lockf) {
      return this.lockf(ctx, locker, write, read);
    }
    switch (locker) {
      case Locker.none:
        return locker;
      case Locker.exclusive:
        return this._write(ctx);
      case Locker.shared:
        return this._read(ctx);
    }
    if (write || read) {
      return this._write(ctx);
    }
    return Locker.none;
  }
  private async _write(ctx?: Context): Promise<Locker.none> {
    if (this.lock_ == Locker.none) {
      this.locked_ = await this.er.rw.lock(ctx);
      this.lock_ = Locker.exclusive;
    } else if (this.lock_ == Locker.shared) {
      const locked = this.locked_!;
      this.locked_ = undefined;
      this.lock_ = Locker.none;
      locked.unlock();

      this.locked_ = await this.er.rw.lock(ctx);
      this.lock_ = Locker.exclusive;
    }

    if (!this.begin_) {
      await this.er.invoke(Locker.none, {
        ctx: ctx,
        req: {
          what: What.execute,
          sql: `SAVEPOINT ${this.name}`,
        },
      });
      this.begin_ = true;
    }
    return Locker.none;
  }
  private async _read(ctx?: Context): Promise<Locker.none> {
    if (this.lock_ == Locker.none) {
      this.locked_ = await this.er.rw.readLock(ctx);
      this.lock_ = Locker.shared;
    }
    return Locker.none;
  }
  async rollback() {
    if (this.closed_) {
      throw new SqliteError(`Savepoint already closed: ${this.name}`);
    }
    this.closed_ = true;
    const er = this.er;
    if (this.begin_) {
      await this._lock(); // check chain closed
      await er.execute(Locker.none, `ROLLBACK TO ${this.name}`);
      return;
    }

    if (er.showSQL) {
      log.log(`ROLLBACK TO ${this.name} -- 0ms`);
    }
    this.locked_?.unlock();
  }
  async commit() {
    if (this.closed_) {
      throw new SqliteError(`Savepoint already closed: ${this.name}`);
    }
    this.closed_ = true;
    const er = this.er;
    if (this.begin_) {
      await this._lock(); // check chain closed
      await er.execute(Locker.none, `RELEASE ${this.name}`);
      return;
    }

    if (er.showSQL) {
      log.log(`RELEASE ${this.name} -- 0ms`);
    }
    this.locked_?.unlock();
  }
  async init(opts?: ContextArgs) {
    const er = this.er;
    if (this.lockf) {
      // lock root
      await this.lockf(opts?.ctx, undefined, true);
      await er.execute(Locker.none, `SAVEPOINT ${this.name}`);
      this.begin_ = true;
      return;
    }
    // this is root
  }
}
export class SqlSavepoint extends SqlExecutor implements Transaction {
  constructor(private readonly s_: SqlSavepointState) {
    super(s_.er, (ctx, locker, write, read) => {
      return s_.lock(ctx, locker, write, read);
    });
  }
  get isClosed(): boolean {
    return this.s_.closed_;
  }
  rollback() {
    return this.s_.rollback();
  }
  commit() {
    return this.s_.commit();
  }
}
