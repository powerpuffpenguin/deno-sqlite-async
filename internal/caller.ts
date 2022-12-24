// deno-lint-ignore-file no-explicit-any
import { background, Context } from "../deps/easyts/context/mod.ts";
import { Chan, Completer, selectChan } from "../deps/easyts/mod.ts";
import { SqliteError, Status } from "../sqlite.ts";

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
export class Caller {
  private ch_ = new Chan<Task>();
  private done_ = new Chan<void>();
  private closed_ = new Chan<void>();
  constructor(readonly path: string, readonly worker: Worker) {
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
    const ch = this.ch_;
    const done = this.done_;
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
    const cch = ch.readCase();
    const cdone = done.readCase();
    while (true) {
      if (cdone == await selectChan(cch, cdone)) {
        break;
      }
      task = cch.read()!;
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
        what: 1,
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
  isClosed(): boolean {
    return this.done_.isClosed;
  }
  close(): boolean {
    if (this.done_.isClosed) {
      return false;
    }
    this.done_.close();
    return true;
  }
  async wait() {
    await this.closed_.read();
  }

  invoke(ctx: Context | undefined, req: any): Promise<any> {
    if (!ctx) {
      ctx = background();
    }
    if (ctx.isClosed) {
      throw ctx.err;
    } else if (this.done_.isClosed) {
      throw new SqliteError(`db already closed: ${this.path}`);
    }
    const task: Task = {
      req: req,
      c: new Completer(),
    };
    this._invoke(ctx, task);
    return task.c.promise;
  }
  private async _invoke(ctx: Context, task: Task) {
    const done = ctx.done.readCase();
    const done2 = this.done_.readCase();
    const cch = this.ch_.writeCase(task);
    switch (await selectChan(done, done2, cch)) {
      case done:
        task.c.reject(ctx.err);
        break;
      case done2:
        task.c.reject(new SqliteError(`db already closed: ${this.path}`));
        break;
    }
  }
}
