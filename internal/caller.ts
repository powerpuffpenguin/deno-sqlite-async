// deno-lint-ignore-file no-explicit-any
import { Context } from "../deps/easyts/context/mod.ts";
import {
  Caller as ICaller,
  InvokeBatch,
  InvokeBatchResult,
  InvokeExecute,
  InvokeMethod,
  InvokeOptions,
  InvokeQuery,
  InvokeQueryEntries,
  What,
} from "../caller.ts";
import {
  Chan,
  Completer,
  ReadCase,
  ReadChannel,
  selectChan,
} from "../deps/easyts/mod.ts";
import {
  Row,
  RowObject,
  SqliteError,
  SqliteOptions,
  Status,
} from "../sqlite.ts";

export interface InvokeResponse {
  code: number;
  message?: string;
  status?: Status;
  error?: any;
  data?: any;
}

export interface Task {
  req: any;
  c: Completer<any>;
}
export class Caller implements ICaller {
  private ch_ = new Chan<Task>();
  private done_ = new Chan<void>();
  private done2_ = new Chan<void>();
  done(): ReadChannel<void> {
    return this.done_;
  }
  private closed_ = new Chan<void>();
  constructor(
    readonly path: string,
    readonly worker: Worker,
    readonly task: number,
  ) {
    this._serve();
  }
  private readonly init_ = new Completer();
  init() {
    return this.init_.promise;
  }
  private async _serve() {
    // wait ready
    const worker = this.worker;
    const init = this.init_;
    worker.onmessage = (_) => {
      init.resolve();
    };
    await init.promise;

    // work
    let task: undefined | Task;
    worker.onmessage = (evt) => {
      const resp: InvokeResponse = evt.data;
      const c = task!.c;
      switch (resp.code) {
        case 0:
          c.resolve(resp.data);
          break;
        case 1:
          c.reject(new SqliteError(resp.message!, resp.status));
          break;
        default:
          c.reject(resp.error);
          break;
      }
    };
    const ch = this.ch_.readCase();
    const done2 = this.done2_.readCase();
    const done = this.done_.readCase();
    const tasks = new Array<Task>(this.task);
    while (true) {
      if (ch != await selectChan(ch, done, done2)) {
        break;
      }
      task = this._merge(tasks, ch, done, done2, ch.read()!);
      if (!task) {
        break;
      }
      // execute
      worker.postMessage(task.req);
      // wait resp
      try {
        await task.c.promise;
      } catch (_) { //
      }
    }
    // execute close
    task = {
      req: {
        what: What.close,
      },
      c: new Completer(),
    };
    worker.postMessage(task.req);
    // wait close
    try {
      await task.c.promise;
    } catch (_) { //
    }
    worker.terminate();
    this.closed_.close();
  }
  private _merge(
    tasks: Array<Task>,
    ch: ReadCase<Task>,
    done: ReadCase<void>,
    done2: ReadCase<void>,
    task: Task,
  ): Task | undefined {
    let i = 0;
    tasks[i++] = task;
    Merge:
    while (i < tasks.length) {
      switch (selectChan(0, ch, done, done2)) {
        case ch:
          tasks[i++] = ch.read()!;
          break;
        case done:
        case done2:
          {
            const e = new SqliteError(`db already closed: ${this.path}`);
            for (let index = 0; index < i; index++) {
              tasks[index].c.reject(e);
            }
          }
          return;
        default:
          break Merge;
      }
    }
    if (i > 1) {
      return new Tasks(tasks, i);
    }
    return task;
  }
  isClosed(): boolean {
    return this.done_.isClosed;
  }
  close(): boolean {
    if (this.done_.isClosed) {
      return false;
    }
    this.done_.close();
    this.done2_.close();
    return true;
  }
  async wait() {
    await this.closed_.read();
  }

  invoke(
    opts: InvokeOptions,
  ): Promise<any> {
    if (opts?.ctx?.isClosed) {
      throw opts.ctx.err;
    } else if (this.done_.isClosed) {
      throw new SqliteError(`db already closed: ${this.path}`);
    }
    const task: Task = {
      req: opts.req,
      c: new Completer(),
    };
    this._invoke(opts?.ctx, task);
    return task.c.promise;
  }
  private async _invoke(ctx: Context | undefined, task: Task) {
    const done = ctx?.done.readCase();
    const done2 = this.done_.readCase();
    const cch = this.ch_.writeCase(task);
    switch (await selectChan(done!, done2, cch)) {
      case done:
        task.c.reject(ctx!.err);
        break;
      case done2:
        task.c.reject(new SqliteError(`db already closed: ${this.path}`));
        break;
    }
  }
  open(opts: {
    ctx?: Context;
    path: string;
    opts?: SqliteOptions;
  }): Promise<undefined> {
    return this.invoke({
      ctx: opts.ctx,
      req: {
        what: What.open,
        path: opts.path,
        opts: opts.opts,
      },
    });
  }
  execute(opts: InvokeExecute): Promise<undefined> {
    return this.invoke({
      ctx: opts.ctx,
      req: {
        what: What.execute,
        sql: opts.sql,
      },
    });
  }
  query(opts: InvokeQuery): Promise<Array<Row>>;
  query(opts: InvokeQueryEntries): Promise<Array<RowObject>>;
  query(
    opts: InvokeQuery | InvokeQueryEntries,
  ): Promise<Array<Row | RowObject>> {
    return this.invoke({
      ctx: opts.ctx,
      req: {
        what: What.query,
        sql: opts.sql,
        args: opts.args,
        entries: opts.entries,
      },
    });
  }
  batch(opts: InvokeBatch): Promise<Array<InvokeBatchResult>> {
    return this.invoke({
      ctx: opts.ctx,
      req: {
        what: What.batch,
        savepoint: opts.savepoint,
        batch: opts.batch,
      },
    });
  }
  prepare(opts: InvokeExecute): Promise<number> {
    return this.invoke({
      ctx: opts.ctx,
      req: {
        what: What.prepare,
        sql: opts.sql,
      },
    });
  }
  method(opts: InvokeMethod): Promise<any> {
    return this.invoke({
      ctx: opts.ctx,
      req: {
        what: What.method,
        sql: opts.sql,
        args: opts.args,
        result: opts.result,
        method: opts.method,
      },
    });
  }
}

class Tasks {
  c = new Completer<Array<InvokeResponse>>();
  req: any;
  constructor(readonly task: Array<Task>, i: number) {
    const arrs = new Array<any>();
    for (let index = 0; index < i; index++) {
      arrs[index] = task[index].req;
    }
    this.req = {
      what: What.task,
      task: arrs,
    };
    this._serve();
  }
  private async _serve() {
    const tasks = this.task;
    const resps = await this.c.promise;
    for (let i = 0; i < resps.length; i++) {
      const resp = resps[i];
      const c = tasks[i].c;
      switch (resp.code) {
        case 0:
          c.resolve(resp.data);
          break;
        case 1:
          c.reject(new SqliteError(resp.message!, resp.status));
          break;
        default:
          c.reject(resp.error);
          break;
      }
    }
  }
}
