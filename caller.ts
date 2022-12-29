// deno-lint-ignore-file no-explicit-any
import { Context } from "./deps/easyts/context/mod.ts";
import {
  ColumnName,
  QueryParameterSet,
  Row,
  RowObject,
  SqliteOptions,
} from "./sqlite.ts";
export enum What {
  /**
   * @internal
   */
  open = 1,
  /**
   * @internal
   */
  close,
  execute = 10,
  query,
  batch = 20,
  prepare = 30,
  method,
  /**
   * @internal
   */
  task = 40,
}
export enum Method {
  close = "close",
  columns = "columns",
  first = "first",
  firstEntry = "firstEntry",
  all = "all",
  allEntries = "allEntries",
  execute = "execute",
  expandSql = "expandSql",
}
export interface InvokeOptions {
  ctx?: Context;
  req: InvokeRequests;
}
export interface InvokePrepare {
  ctx?: Context;

  sql: string;
}
export interface InvokeExecute {
  ctx?: Context;

  args?: QueryParameterSet;
  sql: string;
}
export interface InvokeQuery {
  ctx?: Context;

  sql: string;
  args?: QueryParameterSet;
  entries?: false;
}
export interface InvokeQueryEntries {
  ctx?: Context;

  sql: string;
  args?: QueryParameterSet;
  entries: true;
}
export interface InvokeBatch {
  ctx?: Context;

  savepoint?: boolean;
  batch: Array<InvokeBatchElement>;
}
export interface InvokeMethod {
  ctx?: Context;

  sql: number;
  args?: QueryParameterSet;
  method: Method;
  result?: boolean;
}

export type InvokeRequests =
  | InvokePrepareRequest
  | InvokeOpenRequest
  | InvokeExecuteRequest
  | InvokeQueryRequest
  | InvokeMethodRequest
  | InvokeBatchRequest;
export interface InvokeRequest {
  what: What;
}
export interface InvokePrepareRequest extends InvokeRequest {
  sql: string;
}
export interface InvokeOpenRequest extends InvokeRequest {
  path: string;
  opts?: SqliteOptions;
}
export interface InvokeExecuteRequest extends InvokeRequest {
  sql: string;

  args?: QueryParameterSet;
}
export interface InvokeQueryRequest extends InvokeRequest {
  sql: string;
  args?: QueryParameterSet;
  entries?: boolean;
}
export interface InvokeMethodRequest extends InvokeRequest {
  sql: number;
  args?: QueryParameterSet;
  method: Method;
  result?: boolean;
}
export interface InvokeBatchRequest extends InvokeRequest {
  savepoint?: boolean;
  batch: Array<InvokeBatchElement>;
}
export interface InvokeBatchElement {
  /**
   * sql or Prepared.id
   */
  sql: string | number;
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
export interface InvokeBatchMethod {
  method: string;
  args?: QueryParameterSet;
  result?: boolean;
}
export interface InvokeBatchResult {
  prepared?: {
    id: number;
    sql: string;
  };
  sql?: Array<Row>;
  prepare?: Array<ColumnName | Row | RowObject> | Row | RowObject | string;
  prepares?: Array<
    Array<ColumnName | Row | RowObject> | Row | RowObject | string | undefined
  >;
}
export interface Caller {
  invoke(
    opts: InvokeOptions,
  ): Promise<any>;
  execute(opts: InvokeExecute): Promise<undefined>;
  query(opts: InvokeQuery): Promise<Array<Row>>;
  query(opts: InvokeQueryEntries): Promise<Array<RowObject>>;
  batch(opts: InvokeBatch): Promise<Array<InvokeBatchResult>>;
  prepare(opts: InvokePrepare): Promise<number>;
  method(opts: InvokeMethod): Promise<any>;
}
