import { QueryParameterSet, Row, SqliteOptions } from "./sqlite.ts";
import { Caller } from "./internal/caller.ts";

export enum What {
  open = 1,
  close,
  execute = 10,
  query,
}

export class DB {
  static async open(
    path = ":memory:",
    opts?: SqliteOptions,
  ): Promise<DB> {
    const w = new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
    });
    const caller = new Caller(path, w);
    await caller.init();
    const db = new DB(path, caller);
    await db._init(path, opts);
    return db;
  }
  private constructor(
    readonly path: string,
    private readonly caller_: Caller,
  ) {}
  private closed_ = false;
  async close(force?: boolean) {
    if (this.closed_) {
      return false;
    }
    this.closed_ = true;
    const caller = this.caller_;
    await caller.invoke({
      what: What.close,
      force: force ? true : false,
    }, true);
    await caller.close();
    return true;
  }
  get isClosed(): boolean {
    return this.closed_;
  }

  private async _init(path: string, opts?: SqliteOptions) {
    try {
      await this.caller_.invoke({
        what: What.open,
        path: path,
        opts: opts,
      });
    } catch (e) {
      this.close(true);
      throw e;
    }
  }
  async execute(sql: string): Promise<void> {
    await this.caller_.invoke({
      what: What.execute,
      sql: sql,
    });
  }

  query<R extends Row = Row>(
    sql: string,
    params?: QueryParameterSet,
  ): Promise<Array<R>> {
    return this.caller_.invoke({
      what: What.query,
      sql: sql,
      params: params,
    });
  }
}
