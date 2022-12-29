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
  args?: QueryParameterSet;
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
  private set_ = new Set<number>();
  constructor(readonly db: DB) {}
  private _id(): number {
    const set = this.set_;
    let val = this.id_;
    while (true) {
      val = val == Number.MAX_SAFE_INTEGER ? 0 : val + 1;
      if (!set.has(val)) {
        set.add(val);
        this.id_ = val == Number.MAX_SAFE_INTEGER ? 0 : val;
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
    this.set_.delete(id);
    this.db.execute(`RELEASE auto_worker_save_${id}`);
  }
  rollback(id: number) {
    this.set_.delete(id);
    this.db.execute(`ROLLBACK auto_worker_save_${id}`);
  }
  clear() {
    this.id_ = 0;
    this.set_.clear();
  }
}
class Preparor {
  private id_ = 0;
  private keys_ = new Map<number, Prepared>();
  constructor(readonly db: DB) {}
  private _id() {
    const keys = this.keys_;
    let val = this.id_;
    while (true) {
      val = val == Number.MAX_SAFE_INTEGER ? 0 : val + 1;
      if (!keys.has(val)) {
        this.id_ = val == Number.MAX_SAFE_INTEGER ? 0 : val;
        return val;
      }
    }
  }
  create(sql: string) {
    const id = this._id();
    this.keys_.set(id, this.db.prepareQuery(sql));
    return id;
  }
  create2(sql: string): [number, Prepared] {
    const id = this._id();
    const val = this.db.prepareQuery(sql);
    this.keys_.set(id, val);
    return [id, val];
  }
  delete(id: number) {
    this.keys_.delete(id);
  }
  private last_: undefined | {
    id: number;
    p: Prepared;
  };
  get(id: number) {
    if (this.last_?.id === id) {
      return this.last_.p!;
    }
    const found = this.keys_.get(id);
    if (found) {
      this.last_ = {
        id: id,
        p: found,
      };
    }
    return found;
  }
  _method(
    id: number,
    method: string,
    args?: QueryParameterSet,
    result?: boolean,
  ): MethodResult | undefined {
    const prepared = this.get(id);
    if (!prepared) {
      throw new SqliteError(`not found prepared(${id})`);
    }
    return this._preparedMethod(id, prepared, method, args, result);
  }
  _preparedMethod(
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
        this.last_ = undefined;
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
  clear() {
    const keys = this.keys_;
    for (const [, p] of keys) {
      p.finalize();
    }
    keys.clear();
    this.id_ = 0;
  }
}
class Database {
  readonly db: DB;
  readonly savepoint: Savepoint;
  readonly preparor: Preparor;
  constructor(req: OpenRequest) {
    const db = new DB(req.path, req.opts);
    this.db = db;
    this.savepoint = new Savepoint(db);
    this.preparor = new Preparor(db);
  }
  close(req: CloseRequest) {
    this.savepoint.clear();
    this.preparor.clear();
    this.db.close(req.force);
  }
  execute(req: ExecuteRequest) {
    if (req.args) {
      this.db.query(req.sql, req.args);
    } else {
      this.db.execute(req.sql);
    }
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
    const preparor = this.preparor;
    let savepoint: number | undefined;
    try {
      if (req.savepoint) {
        savepoint = this.savepoint.save();
      }
      for (const batch of req.batch) {
        if (typeof batch.sql === "number") {
          if (batch.method !== undefined) {
            const v = preparor._method(
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
            const prepared = preparor.get(batch.sql);
            if (!prepared) {
              throw new SqliteError(`not found prepared(${batch.sql})`);
            }
            if (batch.result) {
              const arrs: Array<any> = [];
              for (const node of batch.methods) {
                if (node.result) {
                  arrs.push(preparor._preparedMethod(
                    batch.sql,
                    prepared,
                    node.method,
                    node.args,
                    true,
                  ));
                } else {
                  preparor._preparedMethod(
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
                preparor._preparedMethod(
                  batch.sql,
                  prepared,
                  node.method,
                  node.args,
                );
              }
            }
          } else {
            throw new SqliteError("unknow method prepared.undefined");
          }
        } else if (batch.prepare) {
          const [id, prepared] = preparor.create2(batch.sql);
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
        } catch (_) { //
        } finally {
          preparor.delete(p.id);
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
    return this.preparor.create(req.sql);
  }
  method(req: MethodRequest) {
    return this.preparor.method(req);
  }
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
