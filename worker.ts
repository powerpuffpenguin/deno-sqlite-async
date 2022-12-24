// deno-lint-ignore-file no-explicit-any
import {
  DB,
  QueryParameterSet,
  SqliteError,
  SqliteOptions,
} from "./deps/sqlite/mod.ts";
declare const self: {
  onmessage?: (evt: MessageEvent) => void;
  postMessage(message: any, transfer: Transferable[]): void;
  postMessage(message: any, options?: StructuredSerializeOptions): void;
};

function postError(e: any) {
  if (e instanceof SqliteError) {
    self.postMessage({
      code: 1,
      message: e.message,
      status: e.code,
    });
  } else {
    self.postMessage({
      code: 2,
      error: e,
    });
  }
}

enum What {
  open = 1,
  close,
  execute = 10,
  query,
}
interface RequestMessage {
  what: What;
}
interface OpenRequest extends RequestMessage {
  path: string;
  opts?: SqliteOptions;
}
interface CloseRequestextends extends RequestMessage {
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
  params?: QueryParameterSet;
}
class Database {
  readonly db: DB;
  constructor(req: OpenRequest) {
    this.db = new DB(req.path, req.opts);
  }
  close(req: CloseRequest) {
    this.db.close(req.force);
  }
  execute(req: ExecuteRequest) {
    this.db.execute(req.sql);
  }
  query(req: QueryRequest) {
    return this.db.query(
      req.sql,
      req.params,
    );
  }
}
let db: Database | undefined;
self.onmessage = (evt: MessageEvent) => {
  try {
    const data = evt.data as RequestMessage;
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
          db.close(data as CloseRequestextends);
          db = undefined;
        }
        break;
      case What.execute:
        db!.execute(data as ExecuteRequest);
        break;
      case What.query:
        resp = db!.query(data as QueryRequest);
        break;
      default:
        throw new Error(`unknow worker message: ${JSON.stringify(data)}`);
    }
    self.postMessage({
      code: 0,
      data: resp,
    });
  } catch (e) {
    postError(e);
  }
};
self.postMessage({
  code: 0,
});
