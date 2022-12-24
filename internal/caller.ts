// deno-lint-ignore-file no-explicit-any
import { Completer } from "../deps/easyts/mod.ts";
import { SqliteError, Status } from "../sqlite.ts";

export interface InvokeResponse {
  code: number;
  message?: string;
  status?: Status;
  error?: any;
  data?: any;
}
export class Caller {
  private w_: Worker | undefined;
  constructor(readonly path: string, worker: Worker) {
    this.w_ = worker;
    worker.onmessage = (evt) => {
      const resp: InvokeResponse = evt.data;
      const c = this.c_;
      if (c) {
        this.c_ = undefined;
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
    };
  }
  init() {
    const c = new Completer();
    this.c_ = c;
    return c.promise;
  }
  async close(): Promise<boolean> {
    let w = this.w_;
    if (!w) {
      return false;
    }

    // wait request end
    let c = this.c_;
    while (c) {
      try {
        await c.promise;
      } catch (_) { //
      }
      c = this.c_;
    }

    // check already closed
    w = this.w_;
    if (!w) {
      return false;
    }

    this.w_ = undefined;
    w.onmessage = undefined;
    w.terminate();
    return true;
  }
  private c_: Completer<any> | undefined;

  private last_ = false;
  async invoke(req: any, last?: boolean): Promise<any> {
    if (this.last_) {
      throw new Error(`db already closed: ${this.path}`);
    }
    if (last) {
      this.last_ = true;
    }
    let w = this.w_;
    if (!w) {
      throw new Error(`db already closed: ${this.path}`);
    }

    let c = this.c_;
    while (c) {
      try {
        await c.promise;
      } catch (_) { //
      }
      c = this.c_;
    }
    w = this.w_;
    if (!w) {
      throw new Error(`db already closed: ${this.path}`);
    }
    c = new Completer<any>();
    this.c_ = c;
    w.postMessage(req);
    return c.promise;
  }
}
