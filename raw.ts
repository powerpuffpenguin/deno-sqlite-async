// deno-lint-ignore-file no-explicit-any
import {
  ColumnName,
  QueryParameterSet,
  Row,
  RowObject,
  SqliteError,
  SqliteOptions,
} from "./sqlite.ts";
import { Caller } from "./internal/caller.ts";
import { Context } from "./deps/easyts/context/mod.ts";
import { ArgsOptions, ContextOptions } from "./options.ts";
import {
  Caller as ICaller,
  InvokeBatchElement,
  InvokeBatchMethod,
  InvokeOptions,
  Method,
} from "./caller.ts";

export interface RawOpenOptions extends SqliteOptions {
  /**
   * web worker url
   */
  worker?: URL;
  /**
   * How many different requests can be combined and submitted to the web worker at most
   */
  task?: number;
}

export class RawDB {
  static async open(
    path = ":memory:",
    opts?: RawOpenOptions,
  ): Promise<RawDB> {
    const w = new Worker(
      opts?.worker ?? new URL("./worker.ts", import.meta.url),
      {
        type: "module",
      },
    );
    let task = Math.floor(opts?.task ?? 1000);
    if (task < 1) {
      task = 1000;
    }
    const caller = new Caller(path, w, task);
    await caller.init();
    const db = new RawDB(path, caller);
    await db._init(path, opts);
    return db;
  }
  private constructor(
    readonly path: string,
    private readonly caller_: Caller,
  ) {}
  /**
   * close db
   */
  close() {
    return this.caller_.close();
  }
  done() {
    return this.caller_.done();
  }
  /**
   * wait db close
   */
  async wait() {
    await this.caller_.wait();
  }
  /**
   * if db closed return true else reutrn false
   */
  get isClosed(): boolean {
    return this.caller_.isClosed();
  }

  private async _init(path: string, opts?: SqliteOptions) {
    try {
      await this.caller_.open({
        path: path,
        opts: opts,
      });
    } catch (e) {
      this.close();
      throw e;
    }
  }
  /**
   * Executing sql does not need to return results
   */
  execute(sql: string, opts?: ArgsOptions): Promise<void> {
    return this.caller_.execute({
      ctx: opts?.ctx,
      sql: sql,
      args: opts?.args,
    });
  }
  /**
   * Execute sql and get the returned result
   */
  query(
    sql: string,
    opts?: ArgsOptions,
  ): Promise<Array<Row>> {
    return this.caller_.query({
      ctx: opts?.ctx,
      sql: sql,
      args: opts?.args,
    });
  }
  /**
   * Execute sql and get the returned result
   */
  queryEntries(
    sql: string,
    opts?: ArgsOptions,
  ): Promise<Array<RowObject>> {
    return this.caller_.query({
      ctx: opts?.ctx,
      sql: sql,
      args: opts?.args,
      entries: true,
    });
  }
  /**
   * Pass multiple commands to the worker in batches for execution
   */
  async batch(
    opts: RawBatchOptions,
  ): Promise<Array<RawBatchResult>> {
    const batch = this._formatBatch(opts.batch);

    const arrs: Array<RawBatchResult> = await this.caller_.batch({
      ctx: opts.ctx,
      savepoint: opts.savepoint,
      batch: batch,
    }) as any;
    let i = 0;
    for (const b of batch) {
      if (b.result) {
        if (b.prepare) {
          arrs[i].prepared = new RawPrepared(
            this.caller_,
            (arrs[i] as any).prepared,
            b.sql as string,
          );
        }
        i++;
      }
    }
    return arrs;
  }
  private _formatBatch(batch: Array<RawBatch>): Array<InvokeBatchElement> {
    let prepared = false;
    for (const b of batch) {
      if (b.sql instanceof RawPrepared) {
        prepared = true;
        break;
      }
    }
    return prepared
      ? batch.map<InvokeBatchElement>((v) => {
        if (v.sql instanceof RawPrepared) {
          return {
            sql: v.sql.id,
            args: v.args,
            result: v.result,
            entries: v.entries,
            method: v.method,
            methods: v.methods,
          };
        }
        return v as InvokeBatchElement;
      })
      : batch as Array<InvokeBatchElement>;
  }
  /**
   * prepare a sql statement so that it can be repeated multiple times without parsing it each time
   */
  async prepare(sql: string, opts?: ContextOptions): Promise<RawPrepared> {
    const id = await this.caller_.prepare({
      ctx: opts?.ctx,
      sql: sql,
    });
    return new RawPrepared(this.caller_, id, sql);
  }
  /**
   * Call the core interface directly
   */
  invoke(opts: InvokeOptions): Promise<any> {
    return this.caller_.invoke(opts);
  }
  /**
   * Return to core implementation
   */
  caller(): ICaller {
    return this.caller_;
  }
}

export interface RawBatchResult {
  prepared?: RawPrepared;
  sql?: Array<Row>;
  prepare?: Array<ColumnName | Row | RowObject> | Row | RowObject | string;
  prepares?: Array<
    Array<ColumnName | Row | RowObject> | Row | RowObject | string | undefined
  >;
}
export interface RawBatchOptions {
  ctx?: Context;
  /**
   * Execute in SAVEPOINT if set to true
   */
  savepoint?: boolean;
  batch: Array<RawBatch>;
}
export interface RawBatch {
  /**
   * sql or Prepared.id
   */
  sql: string | number | RawPrepared;
  /**
   * Bind to sql statement or Prepared parameter
   */
  args?: QueryParameterSet;
  /**
   * Set whether the sql statement needs to return a value
   */
  result?: boolean;
  /**
   * Return query results as RowObject
   */
  entries?: boolean;
  /**
   * If 'sql' is a string and 'prepare' is true create a Prepared
   */
  prepare?: boolean;
  /**
   * prepare method
   */
  method?: Method;
  /**
   * prepare batch method
   */
  methods?: Array<InvokeBatchMethod>;
}

export class RawPrepared {
  private id_?: number;
  constructor(
    private readonly caller_: Caller,
    readonly id: number,
    readonly sql: string,
  ) {
    this.id_ = id;
  }
  get isClosed(): boolean {
    return this.id_ === undefined;
  }
  close(): boolean {
    const id = this.id_;
    if (id === undefined) {
      return false;
    }
    this.id_ = undefined;
    this._close(id);
    return true;
  }
  private async _close(id: number) {
    try {
      await this.caller_.method({
        sql: id,
        method: Method.close,
      });
    } catch (_) { //
    }
  }
  columns(opts?: ContextOptions): Promise<Array<ColumnName>> {
    const id = this.id_;
    if (id == undefined) {
      throw new SqliteError(`Prepared(${this.id}) already closed`);
    }
    return this.caller_.method({
      ctx: opts?.ctx,
      sql: id,
      method: Method.columns,
      result: true,
    });
  }
  first(opts?: ArgsOptions): Promise<Row | undefined> {
    const id = this.id_;
    if (id == undefined) {
      throw new SqliteError(`Prepared(${this.id}) already closed`);
    }
    return this.caller_.method({
      ctx: opts?.ctx,
      sql: id,
      method: Method.first,
      args: opts?.args,
      result: true,
    });
  }
  firstEntry(
    opts?: ArgsOptions,
  ): Promise<RowObject | undefined> {
    const id = this.id_;
    if (id == undefined) {
      throw new SqliteError(`Prepared(${this.id}) already closed`);
    }
    return this.caller_.method({
      ctx: opts?.ctx,
      sql: id,
      method: Method.firstEntry,
      args: opts?.args,
      result: true,
    });
  }
  all(
    opts?: ArgsOptions,
  ): Promise<Array<Row>> {
    const id = this.id_;
    if (id == undefined) {
      throw new SqliteError(`Prepared(${this.id}) already closed`);
    }
    return this.caller_.method({
      ctx: opts?.ctx,
      sql: id,
      method: Method.all,
      args: opts?.args,
      result: true,
    });
  }
  allEntries(
    opts?: ArgsOptions,
  ): Promise<Array<RowObject>> {
    const id = this.id_;
    if (id == undefined) {
      throw new SqliteError(`Prepared(${this.id}) already closed`);
    }
    return this.caller_.method({
      ctx: opts?.ctx,
      sql: id,
      method: Method.allEntries,
      args: opts?.args,
      result: true,
    });
  }
  execute(
    opts?: ArgsOptions,
  ): Promise<undefined> {
    const id = this.id_;
    if (id == undefined) {
      throw new SqliteError(`Prepared(${this.id}) already closed`);
    }
    return this.caller_.method({
      ctx: opts?.ctx,
      sql: id,
      method: Method.execute,
      args: opts?.args,
    });
  }
  expandSql(
    opts?: ArgsOptions,
  ): Promise<string> {
    const id = this.id_;
    if (id == undefined) {
      throw new SqliteError(`Prepared(${this.id}) already closed`);
    }
    return this.caller_.method({
      ctx: opts?.ctx,
      sql: id,
      method: Method.expandSql,
      args: opts?.args,
      result: true,
    });
  }
  async batch(methods: Array<InvokeBatchMethod>, opts?: RawBatchOptions) {
    const id = this.id_;
    if (id == undefined) {
      throw new SqliteError(`Prepared(${this.id}) already closed`);
    }
    let result: boolean | undefined;
    for (const method of methods) {
      if (method.result) {
        result = true;
        break;
      }
    }

    return await this.caller_.batch({
      ctx: opts?.ctx,
      savepoint: opts?.savepoint,
      batch: [
        {
          sql: id,
          result: result,
          methods: methods,
        },
      ],
    });
  }
}
