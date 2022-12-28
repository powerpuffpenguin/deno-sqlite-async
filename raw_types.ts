import { Context } from "./deps/easyts/context/mod.ts";
import { QueryParameterSet, SqliteOptions } from "./sqlite.ts";
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
  req: InvokeRequestLike;
}
export type InvokeRequestLike =
  | InvokeOpen
  | InvokeExecute
  | InvokeQuery
  | InvokeMethod
  | InvokeBatch;
export interface InvokeRequest {
  what: What;
}
export interface InvokeOpen extends InvokeRequest {
  path: string;
  opts?: SqliteOptions;
}
export interface InvokeExecute extends InvokeRequest {
  sql: string;
  args?: QueryParameterSet;
}
export interface InvokeQuery extends InvokeRequest {
  sql: string;
  args?: QueryParameterSet;
  entries?: boolean;
}
export interface InvokeMethod extends InvokeRequest {
  sql: number;
  args?: QueryParameterSet;
  method: Method;
  result?: boolean;
}
export interface InvokeBatch extends InvokeRequest {
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
  methods?: Array<BatchMethod>;
}
export interface BatchMethod {
  method: string;
  args?: QueryParameterSet;
  result?: boolean;
}
