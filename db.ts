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
export class SqlPrepare implements CreatorPrepared {
  constructor(protected readonly er_: _Executor) {}
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
  execute(sql: string, opts?: ExecuteArgs): Promise<void> {
    return this.er_.execute(opts?.lock ?? Locker.shared, sql, {
      ctx: opts?.ctx,
      args: opts?.args,
    });
  }
  rawInsert(
    sql: string,
    opts?: ExecuteArgs,
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
  insert(
    table: string,
    values: Record<string, any>,
    opts?: InsertArgs,
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
  rawDelete(sql: string, opts?: ExecuteArgs): Promise<number | bigint> {
    return this.er_.changes(
      opts?.lock ?? Locker.shared,
      sql,
      {
        ctx: opts?.ctx,
        args: opts?.args,
      },
    );
  }
  delete(table: string, opts?: DeleteArgs): Promise<number | bigint> {
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
  rawUpdate(sql: string, opts?: ExecuteArgs): Promise<number | bigint> {
    return this.er_.changes(
      opts?.lock ?? Locker.shared,
      sql,
      {
        ctx: opts?.ctx,
        args: opts?.args,
      },
    );
  }
  update(
    table: string,
    values: Record<string, any>,
    opts?: UpdateArgs,
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
  rawQuery(
    sql: string,
    opts?: ExecuteArgs,
  ): Promise<Array<Row>> {
    return this.er_.query(
      opts?.lock ?? Locker.shared,
      sql,
      {
        ctx: opts?.ctx,
        args: opts?.args,
      },
    );
  }
  rawQueryEntries(
    sql: string,
    opts?: ExecuteArgs,
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
  query(
    table: string,
    opts?: QueryArgs,
  ): Promise<Array<Row>> {
    const builder = new Builder();
    builder.query(table, opts);
    return this.er_.query(
      opts?.lock ?? Locker.shared,
      builder.sql(),
      {
        ctx: opts?.ctx,
        args: builder.args(),
      },
    );
  }
  queryEntries(
    table: string,
    opts?: QueryArgs,
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

  batch() {
    return new Batch(this.er_);
  }
  batchCommit(
    batch: BatchExecutor,
    opts?: BatchCommit,
  ): Promise<Array<BatchResult>> {
    return batch.commit(opts);
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
    return this.er_.method(opts?.lock ?? Locker.none, {
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
    this.lock_ = Locker.shared;

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
    this.lock_ = Locker.shared;

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
    this.lock_ = Locker.shared;
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
    this.lock_ = Locker.shared;

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
    this.lock_ = Locker.shared;

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
    this.lock_ = Locker.shared;

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
    this.lock_ = Locker.shared;

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
      case Method.execute:
        this.sqls_.push({
          sql: preparor.sql,
          args: opts?.args,
          method: method,
        });
        break;
    }

    if (method != Method.expandSql && method != Method.columns) {
      this.lock_ = Locker.shared;
    }

    return this;
  }
}
