import { Row, SqliteError } from "./sqlite.ts";
import { RawDB, RawOpenOptions, RawOptions } from "./raw.ts";
import {
  ExecuteOptions,
  InsertOptions,
  Locker,
  RawInsertOptions,
} from "./executor.ts";
import { Locked, RW } from "./internal/rw.ts";
import { Context } from "./deps/easyts/context/mod.ts";
import { Builder } from "./builder.ts";
export interface OpenOptions extends RawOpenOptions {
  /**
   * current db version
   */
  version?: number;
}
export class _Executor {
  rw: RW;
  constructor(readonly db: RawDB) {
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
  async execute(lock: Locker, sql: string, opts?: RawOptions): Promise<void> {
    const locked = await this._locked(lock, opts?.ctx);
    if (!locked) {
      return await this.db.execute(sql, opts);
    }
    try {
      return await this.db.execute(sql, opts);
    } finally {
      locked?.unlock();
    }
  }
  async query(lock: Locker, sql: string, opts?: RawOptions): Promise<Row> {
    const locked = await this._locked(lock, opts?.ctx);
    if (!locked) {
      return await this.db.query(sql, opts);
    }
    try {
      return await this.db.query(sql, opts);
    } finally {
      locked?.unlock();
    }
  }
  async insert(lock: Locker, sql: string, opts?: RawOptions) {
    const locked = await this._locked(lock, opts?.ctx);
    if (!locked) {
      return await this.db.batch({
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
    }
    try {
      return await this.db.batch({
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
    const db = new DB(new _Executor(rawdb));

    return db;
  }
  get raw() {
    return this.er_.db;
  }
  constructor(private readonly er_: _Executor) {}
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
  async rawInsert(
    sql: string,
    opts?: RawInsertOptions,
  ): Promise<number | bigint> {
    const rows = await this.er_.insert(
      opts?.lock ?? Locker.shared,
      sql,
      {
        ctx: opts?.ctx,
        args: opts?.args,
      },
    );
    const row = rows[0].sql![0];
    return row[0] as number;
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
  async insert(
    table: string,
    values: Record<string, any>,
    opts?: InsertOptions,
  ): Promise<number | bigint> {
    const builder = new Builder();
    builder.insert(table, values, opts?.conflict);
    const rows = await this.er_.insert(
      opts?.lock ?? Locker.shared,
      builder.sql(),
      {
        ctx: opts?.ctx,
        args: builder.args(),
      },
    );
    const row = rows[0].sql![0];
    return row[0] as number;
  }
}
