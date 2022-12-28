// deno-lint-ignore-file no-explicit-any
import {
  DB,
  PreparedQuery,
  QueryParameterSet,
  Row,
  RowObject,
  SqliteError,
  SqliteOptions,
} from "./deps/sqlite/mod.ts";
declare const self: {
  onmessage?: (evt: MessageEvent) => void;
  postMessage(message: any, transfer: Transferable[]): void;
  postMessage(message: any, options?: StructuredSerializeOptions): void;
};

function getError(e: any) {
  if (e instanceof SqliteError) {
    return {
      code: 1,
      message: e.message,
      status: e.code,
    };
  } else {
    return {
      code: 2,
      error: e,
    };
  }
}

enum What {
  open = 1,
  close,
  execute = 10,
  query,
  batch = 20,
  prepare = 30,
  method,
  task = 40,
}
type Prepared = PreparedQuery<Row, RowObject, QueryParameterSet>;
interface RequestMessage {
  what: What;
}
interface TaskMessage extends RequestMessage {
  what: What;
  task: Array<RequestMessage>;
}
interface OpenRequest extends RequestMessage {
  path: string;
  opts?: SqliteOptions;
}
interface CloseRequest extends RequestMessage {
  force: boolean;
}
interface CloseRequest extends RequestMessage {
  force: boolean;
}
interface ExecuteRequest extends RequestMessage {
  sql: string;
}
interface QueryRequest extends RequestMessage {
  sql: string;
  args?: QueryParameterSet;
  entries?: boolean;
}
interface BatchRequest extends RequestMessage {
  savepoint?: boolean;
  batch: Array<{
    sql: string | number;
    prepare?: boolean;
    args?: QueryParameterSet;
    result?: boolean;
    entries?: boolean;
    method?: string;
    methods?: Array<{
      method: string;
      args?: QueryParameterSet;
      result?: boolean;
    }>;
  }>;
}
interface PrepareRequest extends RequestMessage {
  sql: string;
}
interface MethodRequest extends RequestMessage {
  sql: number;
  args?: QueryParameterSet;
  result?: boolean;
  method: string;
}
interface MethodResult {
  prepare?: any;
}
interface BatchResult extends MethodResult {
  prepared?: number;
  sql?: Array<Row | RowObject>;
  prepares?: Array<any>;
}
class Savepoint {
  private id_ = 0;
  private set = new Set<number>();
  constructor(readonly db: DB) {}
  private _id(): number {
    const set = this.set;
    let val = this.id_;
    while (true) {
      val++;
      if (!set.has(val)) {
        set.add(val);
        if (val == Number.MAX_SAFE_INTEGER) {
          this.id_ = 0;
        } else {
          this.id_ = val;
        }
        break;
      }
    }
    return val;
  }
  save(): number {
    const id = this._id();
    this.db.execute(`SAVEPOINT auto_worker_save_${id}`);
    return id;
  }
  release(id: number) {
    this.set.delete(id);
    this.db.execute(`RELEASE auto_worker_save_${id}`);
  }
  rollback(id: number) {
    this.set.delete(id);
    this.db.execute(`ROLLBACK auto_worker_save_${id}`);
  }
}
class Database {
  readonly db: DB;
  readonly savepoint: Savepoint;
  constructor(req: OpenRequest) {
    const db = new DB(req.path, req.opts);
    this.db = db;
    this.savepoint = new Savepoint(db);
  }
  close(req: CloseRequest) {
    const keys = this.keys_;
    for (const [, p] of keys) {
      p.finalize();
    }
    keys.clear();
    this.db.close(req.force);
  }
  execute(req: ExecuteRequest) {
    this.db.execute(req.sql);
  }
  query(req: QueryRequest) {
    if (req.entries) {
      return this.db.queryEntries(
        req.sql,
        req.args,
      );
    }
    return this.db.query(
      req.sql,
      req.args,
    );
  }
  batch(req: BatchRequest) {
    const result: Array<BatchResult> = [];
    const ps = new Array<{
      id: number;
      prepared: Prepared;
    }>();
    const keys = this.keys_;
    let savepoint: number | undefined;
    try {
      if (req.savepoint) {
        savepoint = this.savepoint.save();
      }
      for (const batch of req.batch) {
        if (typeof batch.sql === "number") {
          if (batch.method !== undefined) {
            const v = this._method(
              batch.sql,
              batch.method!,
              batch.args,
              batch.result,
            );
            if (batch.result) {
              result.push({
                prepare: v?.prepare,
              });
            }
          } else if (batch.methods !== undefined) {
            const prepared = keys.get(batch.sql);
            if (!prepared) {
              throw new SqliteError(`not found prepared(${batch.sql})`);
            }
            if (batch.result) {
              const arrs: Array<any> = [];
              for (const node of batch.methods) {
                if (node.result) {
                  arrs.push(this._preparedMethod(
                    batch.sql,
                    prepared,
                    node.method,
                    node.args,
                    true,
                  ));
                } else {
                  this._preparedMethod(
                    batch.sql,
                    prepared,
                    node.method,
                    node.args,
                  );
                }
              }
              result.push({
                prepares: arrs,
              });
            } else {
              for (const node of batch.methods) {
                this._preparedMethod(
                  batch.sql,
                  prepared,
                  node.method,
                  node.args,
                );
              }
            }
          }
        } else if (batch.prepare) {
          const id = this._id();
          const prepared = this.db.prepareQuery(batch.sql);
          keys.set(id, prepared);
          ps.push({
            id: id,
            prepared: prepared,
          });
          if (batch.result) {
            result.push({
              prepared: id,
            });
          }
        } else {
          if (batch.result) {
            result.push({
              sql: batch.entries
                ? this.db.queryEntries(batch.sql, batch.args)
                : this.db.query(batch.sql, batch.args),
            });
          } else {
            if (batch.args) {
              this.db.query(batch.sql, batch.args);
            } else {
              this.db.execute(batch.sql);
            }
          }
        }
      }

      if (savepoint !== undefined) {
        this.savepoint.release(savepoint);
      }
    } catch (e) {
      for (const p of ps) {
        try {
          p.prepared.finalize();
          keys.delete(p.id);
        } catch (_) { //
        }
      }
      if (savepoint !== undefined) {
        try {
          this.savepoint.rollback(savepoint);
        } catch (_) { //
        }
      }
      throw e;
    }
    return result;
  }
  prepare(req: PrepareRequest) {
    const id = this._id();
    this.keys_.set(id, this.db.prepareQuery(req.sql));
    return id;
  }
  private _method(
    id: number,
    method: string,
    args?: QueryParameterSet,
    result?: boolean,
  ): MethodResult | undefined {
    const keys = this.keys_;
    const prepared = keys.get(id);
    if (!prepared) {
      throw new SqliteError(`not found prepared(${id})`);
    }
    return this._preparedMethod(id, prepared, method, args, result);
  }
  private _preparedMethod(
    id: number,
    prepared: Prepared,
    method: string,
    args?: QueryParameterSet,
    result?: boolean,
  ): MethodResult | undefined {
    let v: any;
    switch (method) {
      case "close":
        try {
          prepared.finalize();
        } catch (_) { //
        }
        this.keys_.delete(id);
        break;
      case "columns":
        v = prepared.columns();
        break;
      case "first":
        v = prepared.first(args);
        break;
      case "firstEntry":
        v = prepared.firstEntry(args);
        break;
      case "all":
        v = prepared.all(args);
        break;
      case "allEntries":
        v = prepared.allEntries(args);
        break;
      case "execute":
        prepared.execute(args);
        break;
      case "expandSql":
        v = prepared.expandSql(args);
        break;
      default:
        throw new SqliteError(`unknow method prepared.${method}`);
    }
    if (result) {
      return {
        prepare: v,
      };
    }
  }
  method(req: MethodRequest) {
    return this._method(req.sql, req.method, req.args, req.result)?.prepare;
  }
  private _id() {
    const keys = this.keys_;
    let val = this.id_;
    while (true) {
      val++;
      if (!keys.has(val)) {
        if (val == Number.MAX_SAFE_INTEGER) {
          this.id_ = 0;
        } else {
          this.id_ = val;
        }
        return val;
      }
    }
  }
  private id_ = 0;
  private keys_ = new Map<number, Prepared>();
}
let db: Database | undefined;
function doTask(data: RequestMessage) {
  try {
    let resp: any;
    switch (data.what) {
      case What.open:
        if (db) {
          throw new Error(`db already opened`);
        }
        db = new Database(data as OpenRequest);
        break;
      case What.close:
        if (db) {
          db.close(data as CloseRequest);
          db = undefined;
        }
        break;
      case What.execute:
        db!.execute(data as ExecuteRequest);
        break;
      case What.query:
        resp = db!.query(data as QueryRequest);
        break;
      case What.batch:
        resp = db!.batch(data as BatchRequest);
        break;
      case What.prepare:
        resp = db!.prepare(data as PrepareRequest);
        break;
      case What.method:
        resp = db!.method(data as MethodRequest);
        break;
      default:
        throw new Error(`unknow worker message: ${JSON.stringify(data)}`);
    }
    return {
      code: 0,
      data: resp,
    };
  } catch (e) {
    return getError(e);
  }
}
self.onmessage = (evt: MessageEvent) => {
  const data = evt.data as RequestMessage;
  if (data.what == What.task) {
    const evt = data as TaskMessage;
    const result = new Array<any>(evt.task.length);
    let i = 0;
    for (const task of evt.task) {
      result[i++] = doTask(task);
    }
    return self.postMessage({
      code: 0,
      data: result,
    });
  } else {
    self.postMessage(doTask(data));
  }
};
self.postMessage({
  code: 0,
});
