// deno-lint-ignore-file no-explicit-any
import { ColumnVar } from "./builder.ts";
import { Method } from "./caller.ts";
import { ContextOptions } from "./options.ts";
import { ColumnName, QueryParameterSet, Row, RowObject } from "./sqlite.ts";
/**
 * Insert/Update conflict resolver
 */
export enum Conflict {
  /**
   * When a constraint violation occurs, an immediate ROLLBACK occurs,
   * thus ending the current transaction, and the command aborts with a
   * return code of SQLITE_CONSTRAINT. If no transaction is active
   * (other than the implied transaction that is created on every command)
   * then this algorithm works the same as ABORT.
   */
  rollback = 1,

  /**
   * When a constraint violation occurs,no ROLLBACK is executed
   * so changes from prior commands within the same transaction
   * are preserved. This is the default behavior.
   */
  abort,

  /**
   * When a constraint violation occurs, the command aborts with a return
   * code SQLITE_CONSTRAINT. But any changes to the database that
   * the command made prior to encountering the constraint violation
   * are preserved and are not backed out.
   */
  fail,

  /**
   * When a constraint violation occurs, the one row that contains
   * the constraint violation is not inserted or changed.
   * But the command continues executing normally. Other rows before and
   * after the row that contained the constraint violation continue to be
   * inserted or updated normally. No error is returned.
   */
  ignore,

  /**
   * When a UNIQUE constraint violation occurs, the pre-existing rows that
   * are causing the constraint violation are removed prior to inserting
   * or updating the current row. Thus the insert or update always occurs.
   * The command continues executing normally. No error is returned.
   * If a NOT NULL constraint violation occurs, the NULL value is replaced
   * by the default value for that column. If the column has no default
   * value, then the ABORT algorithm is used. If a CHECK constraint
   * violation occurs then the IGNORE algorithm is used. When this conflict
   * resolution strategy deletes rows in order to satisfy a constraint,
   * it does not invoke delete triggers on those rows.
   * This behavior might change in a future release.
   */
  replace,
}
export interface ConflictArgs {
  /**
   * conflict resolution algorithm
   */
  conflict?: Conflict;
}
export interface WhereArgs {
  /**
   * sql where section
   */
  where?: string;
}
export interface Args {
  /**
   * Parameters bound to sql
   */
  args?: QueryParameterSet;
}
export interface QueryArgs extends Args, WhereArgs {
  distinct?: boolean;
  /**
   * SELECT columns or SELECT *
   */
  columns?: Array<string>;
  groupBy?: string;
  having?: string;
  orderBy?: string;
  limit?: number;
  offset?: number | bigint;
}
/**
 * The sqlite provided by WebAssembly cannot correctly acquire the file lock, but you can use the lock inside the process, which can ensure that the current process uses sqlite correctly
 */
export enum Locker {
  /**
   * No locking
   */
  none,
  /**
   * Lock shared locks, multiple requests using shared locks may be executed in parallel
   */
  shared,
  /**
   * Lock the exclusive lock, which will ensure that any other requests using the exclusive lock/shared lock will not be executed
   */
  exclusive,
}

export interface Options extends ContextOptions {
  lock?: Locker;
}
export interface ExecuteOptions extends Options {
  args?: QueryParameterSet;
}

export interface InsertOptions extends Options {
  conflict?: Conflict;
}
export interface PrepareInsertOptions extends ContextOptions {
  conflict?: Conflict;
}

export interface QueryOptions extends ExecuteOptions {
  distinct?: boolean;
  columns?: Array<string>;
  where?: string;
  groupBy?: string;
  having?: string;
  orderBy?: string;
  limit?: number;
  offset?: number | bigint;
}
export interface PrepareQueryOptions extends ContextOptions {
  distinct?: boolean;
  columns?: Array<string>;
  where?: string;
  groupBy?: string;
  having?: string;
  orderBy?: string;
  limit?: number;
  offset?: number | bigint;
}

export interface UpdateOptions extends ExecuteOptions {
  where?: string;
  conflict?: Conflict;
}
export interface PrepareUpdateOptions extends ContextOptions {
  where?: string;
  conflict?: Conflict;
}

export interface DeleteOptions extends ExecuteOptions {
  where?: string;
}
export interface PrepareDeleteOptions extends ContextOptions {
  where?: string;
}

export interface Executor {
  /**
   * Execute an SQL query with no return value.
   *
   * ```
   * await db.execute(
   *    'CREATE TABLE Test (id INTEGER PRIMARY KEY, name TEXT, value INTEGER, num REAL)');
   * ```
   */
  execute(sql: string, opts?: ExecuteOptions): Promise<void>;
  /**
   * Executes a raw SQL INSERT query and returns the last inserted row ID.
   * ```
   * const id1 = await database.rawInsert(
   *    'INSERT INTO Test(name, value, num) VALUES("some name", 1234, 456.789)');
   * ```
   *
   * 0 could be returned for some specific conflict algorithms if not inserted.
   */
  rawInsert(
    sql: string,
    opts?: ExecuteOptions,
  ): Promise<number | bigint>;
  /**
   * This method helps insert a map of [values]
   * into the specified [table] and returns the
   * id of the last inserted row.
   *
   * ```
   *    const value = {
   *      'age': 18,
   *      'name': 'value'
   *    };
   *    const id = await db.insert(
   *      'table',
   *      value,
   *      conflictAlgorithm: ConflictAlgorithm.replace,
   *    );
   * ```
   * 0 could be returned for some specific conflict algorithms if not inserted.
   */
  insert(
    table: string,
    values: Record<string, any>,
    opts?: InsertOptions,
  ): Promise<number | bigint>;

  /**
   * This is a helper to query a table and return the items found. All optional
   * clauses and filters are formatted as SQL queries
   * excluding the clauses' names.
   *
   * ```
   *  const rows = await db.query(tableTodo, {
   *      columns: ['columnId', 'columnDone', 'columnTitle'],
   *      where: 'columnId = ?',
   *      args: [id]
   *  });
   * ```
   */
  query(
    table: string,
    opts?: QueryOptions,
  ): Promise<Array<RowObject>>;
  /**
   * Executes a raw SQL SELECT query and returns a list
   * of the rows that were found.
   *
   * ```
   * const rows = await database.rawQuery('SELECT * FROM Test');
   * ```
   */
  rawQuery(
    sql: string,
    opts?: ExecuteOptions,
  ): Promise<Array<RowObject>>;

  /**
   * Executes a raw SQL UPDATE query and returns
   * the number of changes made.
   *
   * ```
   * int count = await database.rawUpdate(
   *   'UPDATE Test SET name = ?, value = ? WHERE name = ?', {
   *   args: ['updated name', '9876', 'some name']});
   * ```
   */
  rawUpdate(sql: string, opts?: ExecuteOptions): Promise<number | bigint>;

  /**
   * Convenience method for updating rows in the database. Returns
   * the number of changes made
   *
   * Update [table] with [values], a map from column names to new column
   * values. null is a valid value that will be translated to NULL.
   *
   * ```
   * const count = await db.update(tableTodo, todo.toMap(), {
   *    where: `${columnId} = ?`, args: [todo.id]});
   * ```
   */
  update(
    table: string,
    values: Record<string, any>,
    opts?: UpdateOptions,
  ): Promise<number | bigint>;

  /**
   * Executes a raw SQL DELETE query and returns the
   * number of changes made.
   *
   * ```
   * const count = await db
   *   .rawDelete('DELETE FROM Test WHERE name = ?', {args: ['another name']});
   * ```
   */
  rawDelete(sql: string, opts?: ExecuteOptions): Promise<number | bigint>;
  /**
   * Convenience method for deleting rows in the database.
   *
   * Delete from [table]
   *
   * You may include ?s in the where clause, which will be replaced by the
   * values from [args]
   *
   * Returns the number of rows affected.
   * ```
   *  const count = await db.delete(tableTodo, {where: 'columnId = ?', args: [id]});
   * ```
   */
  delete(table: string, opts?: DeleteOptions): Promise<number | bigint>;

  prepare(sql: string, opts?: ContextOptions): Promise<Preparor>;
  prepareChanges(): Preparor;
  prepareLastInsertRowid(): Preparor;
  prepareInsert(
    table: string,
    columns: Array<string> | Array<ColumnVar>,
    opts?: PrepareInsertOptions,
  ): Promise<Preparor>;
  prepareQuery(table: string, opts?: PrepareQueryOptions): Promise<Preparor>;
  prepareUpdate(
    table: string,
    columns: Array<string> | Array<ColumnVar>,
    opts?: PrepareUpdateOptions,
  ): Promise<Preparor>;
  prepareDelete(
    table: string,
    opts?: PrepareDeleteOptions,
  ): Promise<Preparor>;

  /**
   * Creates a batch, used for performing multiple operation
   * in a single atomic operation.
   *
   * a batch can be commited using [Batch.commit]
   *
   * If the batch was created in a transaction, it will be commited
   * when the transaction is done
   */
  batch(): BatchExecutor;
}

export interface Preparor {
  /**
   * close and release resources
   */
  close(): boolean;
  /**
   * return resource id
   */
  get id(): number;
  /**
   * Whether the resource has been closed
   */
  get isClosed(): boolean;
  columns(opts?: Options): Promise<Array<ColumnName>>;
  first(opts?: ExecuteOptions): Promise<Row | undefined>;
  firstEntry(
    opts?: ExecuteOptions,
  ): Promise<RowObject | undefined>;
  all(
    opts?: ExecuteOptions,
  ): Promise<Array<Row>>;
  allEntries(
    opts?: ExecuteOptions,
  ): Promise<Array<RowObject>>;
  execute(
    opts?: ExecuteOptions,
  ): Promise<undefined>;
  expandSql(
    opts?: ExecuteOptions,
  ): Promise<string>;
}

/**
 * Different types of commands in Batch will return results in different fields
 */
export interface BatchResult {
  /**
   * If there is no special instruction, the results will be returned to the sql field
   */
  sql?: Array<Row | number | bigint | RowObject>;
  /**
   * If the command is to create a Preparer, the created Preparer is set here
   */
  prepared?: Preparor;
  /**
   * The result returned by executing the Prepare method is here
   */
  prepare?: Array<ColumnName | Row | RowObject> | Row | RowObject | string;
}
export type BatchValue =
  | Array<ColumnName | Row | RowObject>
  | Row
  | RowObject
  | string
  | undefined
  | Preparor
  | number
  | bigint;

export interface BatchCommit extends Options {
  /**
   * If true execute the command in SAVEPOINT
   *
   * {@link https://www.sqlite.org/lang_savepoint.html}
   */
  savepoint?: boolean;
}

export interface BatchNameArgs {
  /**
   * If set then values.set(name,val)
   */
  name?: string;
}
export interface BatchArgs extends BatchNameArgs, Args {}
export interface BatchExecuteArgs extends BatchArgs {
  /**
   * If set true need return result
   */
  result?: boolean;
}

export interface BatchInsertArgs extends BatchNameArgs, ConflictArgs {}
export interface BatchDeleteArgs extends BatchArgs, WhereArgs {}
export interface BatchUpdateArgs extends BatchArgs, ConflictArgs, WhereArgs {}
export interface BatchQueryArgs extends BatchNameArgs, QueryArgs {}
export interface BatchPrepareInsertArgs extends BatchNameArgs, ConflictArgs {}
export interface BatchPrepareDeleteArgs extends BatchNameArgs, WhereArgs {}
export interface BatchPrepareUpdateArgs
  extends BatchNameArgs, WhereArgs, ConflictArgs {}
export interface BatchPrepareQueryArgs extends BatchNameArgs, WhereArgs {
  distinct?: boolean;
  columns?: Array<string>;
  groupBy?: string;
  having?: string;
  orderBy?: string;
  limit?: number;
  offset?: number | bigint;
}
/**
 * Execute a set of sql commands in batches, which is faster than executing each command individually
 */
export interface BatchExecutor {
  /**
   * Submit the command to sqlite for execution
   */
  commit(opts?: BatchCommit): Promise<Array<BatchResult>>;
  /**
   * If a name is set for the command return value, the command return value can be obtained from values after commit
   */
  values(): Map<string, BatchValue> | undefined;

  /**
   * Add a SQL command to the batch
   *
   * @see {@link Executor.execute}
   */
  execute(sql: string, opts?: BatchExecuteArgs): void;

  /**
   * Add an INSERT command to the batch
   *
   * @see {@link Executor.rawInsert}
   */
  rawInsert(sql: string, opts?: BatchArgs): void;

  /**
   * Add an INSERT command to the batch
   *
   * @see {@link Executor.insert}
   */
  insert(
    table: string,
    values: Record<string, any>,
    opts?: BatchInsertArgs,
  ): void;

  /**
   * Add a DELETE command to the batch
   *
   * @see {@link Executor.rawDelete}
   */
  rawDelete(sql: string, opts?: BatchArgs): void;

  /**
   * Add a DELETE command to the batch
   *
   * @see {@link Executor.delete}
   */
  delete(table: string, opts?: BatchDeleteArgs): void;

  /**
   * Add a UPDATE command to the batch
   * @see {@link Executor.rawUpdate}
   */
  rawUpdate(sql: string, opts?: BatchArgs): void;

  /**
   * Add a UPDATE command to the batch
   *
   * @see {@link Executor.update}
   */
  update(
    table: string,
    values: Record<string, any>,
    opts?: BatchUpdateArgs,
  ): void;

  /**
   * Add a SELECT command to the batch
   *
   * @see {@link Executor.query}
   */
  query(table: string, opts?: BatchArgs): void;
  /**
   * Add a SELECT command to the batch
   *
   * @see {@link Executor.rawQuery}
   */
  rawQuery(sql: string, opts?: BatchQueryArgs): void;

  /**
   * Prepares the given SQL query, so that it
   * can be run multiple times and potentially
   * with different parameters.
   *
   * @see {@link Executor.prepare}
   */
  prepare(sql: string, opts?: BatchNameArgs): void;
  /**
   * @see {@link Executor.prepareInsert}
   */
  prepareInsert(
    table: string,
    columns: Array<string> | Array<ColumnVar>,
    opts?: BatchPrepareInsertArgs,
  ): void;
  /**
   * @see {@link Executor.prepareDelete}
   */
  prepareDelete(
    table: string,
    opts?: BatchPrepareDeleteArgs,
  ): void;

  /**
   * @see {@link Executor.prepareUpdate}
   */
  prepareUpdate(
    table: string,
    columns: Array<string> | Array<ColumnVar>,
    opts?: BatchPrepareUpdateArgs,
  ): void;

  /**
   * @see {@link Executor.prepareQuery}
   */
  prepareQuery(table: string, opts?: BatchPrepareQueryArgs): void;
  /**
   * Add calls to the Prepare method to the batch
   * @see {@link Preparor}
   */
  method(
    preparor: Preparor,
    method: Method,
    opts?: BatchArgs,
  ): void;
}
