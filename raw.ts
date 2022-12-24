import { QueryParameterSet, Row, SqliteOptions } from "./sqlite.ts";
import { Caller } from "./internal/caller.ts";
import { background, Context } from "./deps/easyts/context/mod.ts";

export enum What {
  open = 1,
  close,
  execute = 10,
  query,
}
export interface OpenOptions extends SqliteOptions {
  /**
   * web worker url
   */
  worker?: URL;
}

export interface Options {
  ctx?: Context;
  args?: QueryParameterSet;
}
export class Raw {
  static async open(
    path = ":memory:",
    opts?: OpenOptions,
  ): Promise<Raw> {
    const w = new Worker(
      opts?.worker ?? new URL("./worker.ts", import.meta.url),
      {
        type: "module",
      },
    );
    const caller = new Caller(path, w);
    await caller.init();
    const db = new Raw(path, caller);
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
      await this.caller_.invoke(background(), {
        what: What.open,
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
  async execute(sql: string, opts?: Options): Promise<void> {
    if (opts?.args) {
      await this.caller_.invoke(opts.ctx, {
        what: What.query,
        sql: sql,
        args: opts.args,
      });
    } else {
      await this.caller_.invoke(opts?.ctx, {
        what: What.execute,
        sql: sql,
      });
    }
  }
  /**
   * Execute sql and get the returned result
   */
  query<R extends Row = Row>(
    sql: string,
    opts?: Options,
  ): Promise<Array<R>> {
    return this.caller_.invoke(opts?.ctx, {
      what: What.query,
      sql: sql,
      args: opts?.args,
    });
  }
}
