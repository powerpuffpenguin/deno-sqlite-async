// deno-lint-ignore-file no-explicit-any
import { background, Context } from "../deps/easyts/context/mod.ts";
import { Chan, Completer, ReadCase, selectChan } from "../deps/easyts/mod.ts";
import { SqliteError, Status } from "../sqlite.ts";
export enum What {
  open = 1,
  close,
  execute = 10,
  query,
  batch = 20,
  prepare = 30,
  method,
  task = 40,
}
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
  done() {
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
    const done = this.done_.readCase();
    const tasks = new Array<Task>(this.task);
    while (true) {
      if (done == await selectChan(ch, done)) {
        break;
      }
      task = this._merge(tasks, ch, done, ch.read()!);
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
  private _merge(
    tasks: Array<Task>,
    ch: ReadCase<Task>,
    done: ReadCase<void>,
    task: Task,
  ): Task | undefined {
    let i = 0;
    tasks[i++] = task;
    Merge:
    while (i < tasks.length) {
      switch (selectChan(0, ch, done)) {
        case ch:
          tasks[i++] = ch.read()!;
          break;
        case done:
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
