// deno-lint-ignore-file no-explicit-any
import { ColumnVar } from "./builder.ts";
import { Method } from "./caller.ts";
import { ColumnName, QueryParameterSet, Row, RowObject } from "./sqlite.ts";
import { Context } from "./deps/easyts/context/mod.ts";
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

export interface SelectArgs {
  /**
   * SELECT DISTINCT ...
   */
  distinct?: boolean;
  /**
   * SELECT columns or SELECT *
   */
  columns?: Array<string>;
  /**
   * sql GROUP BY section
   */
  groupBy?: string;
  /**
   * sql HAVING section
   */
  having?: string;
  /**
   * sql ORDER BY section
   */
  orderBy?: string;
  /**
   * sql LIMIT section
   */
  limit?: number;
  /**
   * sql OFFSET section
   */
  offset?: number | bigint;
}
export interface Args {
  /**
   * Parameters bound to sql
   */
  args?: QueryParameterSet;
}
export interface ContextArgs {
  /**
   * like golang Context
   *
   * @see {@link https://powerpuffpenguin.github.io/ts/easyts/interfaces/context_mod.Context.html}
   */
  ctx?: Context;
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
export interface LockArgs extends ContextArgs {
  /**
   * How to lock
   */
  lock?: Locker;
}
export interface ExecuteArgs extends LockArgs, Args {}

export interface CreatorInsertArgs extends ContextArgs, ConflictArgs {}
export interface CreatorDeleteArgs extends ContextArgs, WhereArgs {}
export interface CreatorUpdateArgs
  extends ContextArgs, ConflictArgs, WhereArgs {}
export interface CreatorQueryArgs extends ContextArgs, WhereArgs, SelectArgs {}
export interface CreatorPrepared {
  /**
   * Create a prepared command that can be reused
   */
  prepare(sql: string, opts?: ContextArgs): Promise<Preparor>;
  /**
   * pre-built commands "SELECT changes()"
   */
  prepareChanges(): Preparor;
  /**
   * pre-built commands "SELECT last_insert_rowid()"
   */
  prepareLastInsertRowid(): Preparor;
  /**
   * Like the "prepare" function, but easier to create "INSERT" commands
   */
  prepareInsert(
    table: string,
    columns: Array<string> | Array<ColumnVar>,
    opts?: CreatorInsertArgs,
  ): Promise<Preparor>;
  /**
   * Like the "prepare" function, but easier to create "DELETE" commands
   */
  prepareDelete(
    table: string,
    opts?: CreatorDeleteArgs,
  ): Promise<Preparor>;
  /**
   * Like the "prepare" function, but easier to create "UPDATE" commands
   */
  prepareUpdate(
    table: string,
    columns: Array<string> | Array<ColumnVar>,
    opts?: CreatorUpdateArgs,
  ): Promise<Preparor>;
  /**
   * Like the "prepare" function, but easier to create "SELECT" commands
   */
  prepareQuery(table: string, opts?: CreatorQueryArgs): Promise<Preparor>;
}
export interface InsertArgs extends ExecuteArgs, ConflictArgs {}
export interface DeleteArgs extends ExecuteArgs, WhereArgs {}
export interface UpdateArgs extends ExecuteArgs, ConflictArgs, WhereArgs {}
export interface QueryArgs extends ExecuteArgs, WhereArgs, SelectArgs {}
export interface Executor extends CreatorPrepared {
  /**
   * Execute an SQL query with no return value.
   *
   * ```
   * await db.execute(
   *    'CREATE TABLE Test (id INTEGER PRIMARY KEY, name TEXT, value INTEGER, num REAL)');
   * ```
   */
  execute(sql: string, opts?: ExecuteArgs): Promise<void>;
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
    opts?: ExecuteArgs,
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
    opts?: InsertArgs,
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
  rawDelete(sql: string, opts?: ExecuteArgs): Promise<number | bigint>;
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
  delete(table: string, opts?: DeleteArgs): Promise<number | bigint>;
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
  rawUpdate(sql: string, opts?: ExecuteArgs): Promise<number | bigint>;

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
    opts?: UpdateArgs,
  ): Promise<number | bigint>;

  query(
    table: string,
    opts?: QueryArgs,
  ): Promise<Array<Row>>;
  /**
   * @see {@link Executor.query}
   */
  queryEntries(
    table: string,
    opts?: QueryArgs,
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
    opts?: ExecuteArgs,
  ): Promise<Array<Row>>;
  /**
   * @see {@link Executor.rawQuery}
   */
  rawQueryEntries(
    sql: string,
    opts?: ExecuteArgs,
  ): Promise<Array<RowObject>>;

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

  /**
   * Submit the contents of the batch to the system for processing
   *
   * You need to call this function instead of calling batch.commit in the transaction
   */
  batchCommit(
    batch: BatchExecutor,
    opts?: BatchCommit,
  ): Promise<Array<BatchResult>>;
}

export interface Preparor {
  /**
   * close and release resources
   */
  close(): boolean;
  /**
   * return resource id
   */
  readonly id: number;
  readonly sql: string;
  /**
   * Whether the resource has been closed
   */
  get isClosed(): boolean;
  /**
   * Returns the column names for this query.
   *
   * @see {@link https://deno.land/x/sqlite/mod.ts?s=PreparedQuery&p=prototype.columns}
   */
  columns(opts?: LockArgs): Promise<Array<ColumnName>>;
  /**
   * Binds the given parameters to the query and returns the first resulting row or undefined when there are no rows returned by the query.
   *
   * @see {@link https://deno.land/x/sqlite/mod.ts?s=PreparedQuery&p=prototype.first}
   */
  first(opts?: ExecuteArgs): Promise<Row | undefined>;
  /**
   * Like first except the row is returned as an object containing key-value pairs.
   *
   * @see {@link https://deno.land/x/sqlite/mod.ts?s=PreparedQuery&p=prototype.firstEntry}
   */
  firstEntry(
    opts?: ExecuteArgs,
  ): Promise<RowObject | undefined>;
  /**
   * Binds the given parameters to the query and returns an array containing all resulting rows.
   *
   * @see {@link https://deno.land/x/sqlite/mod.ts?s=PreparedQuery&p=prototype.all}
   */
  all(
    opts?: ExecuteArgs,
  ): Promise<Array<Row>>;
  /**
   * Like all except each row is returned as an object containing key-value pairs.
   *
   * @see {@link https://deno.land/x/sqlite/mod.ts?s=PreparedQuery&p=prototype.allEntries}
   */
  allEntries(
    opts?: ExecuteArgs,
  ): Promise<Array<RowObject>>;
  /**
   * Binds the given parameters to the query and executes the query, ignoring any rows which might be returned.
   *
   * Using this method is more efficient when the rows returned by a query are not needed or the query does not return any rows.
   *
   * @see {@link https://deno.land/x/sqlite/mod.ts?s=PreparedQuery&p=prototype.execute}
   */
  execute(
    opts?: ExecuteArgs,
  ): Promise<void>;
  /**
   * Returns the SQL string used to construct this query, substituting placeholders (e.g. ?) with their values supplied in params.
   *
   * @see {@link https://deno.land/x/sqlite/mod.ts?s=PreparedQuery&p=prototype.expandSql}
   */
  expandSql(
    opts?: ExecuteArgs,
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

export interface BatchCommit extends LockArgs {
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
export interface BatchQueryArgs extends BatchArgs, SelectArgs, WhereArgs {}
export interface BatchPrepareInsertArgs extends BatchNameArgs, ConflictArgs {}
export interface BatchPrepareDeleteArgs extends BatchNameArgs, WhereArgs {}
export interface BatchPrepareUpdateArgs
  extends BatchNameArgs, WhereArgs, ConflictArgs {}
export interface BatchPrepareQueryArgs
  extends BatchNameArgs, SelectArgs, WhereArgs {}
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
  execute(sql: string, opts?: BatchExecuteArgs): BatchExecutor;

  /**
   * Add an INSERT command to the batch
   *
   * @see {@link Executor.rawInsert}
   */
  rawInsert(sql: string, opts?: BatchArgs): BatchExecutor;

  /**
   * Add an INSERT command to the batch
   *
   * @see {@link Executor.insert}
   */
  insert(
    table: string,
    values: Record<string, any>,
    opts?: BatchInsertArgs,
  ): BatchExecutor;

  /**
   * Add a DELETE command to the batch
   *
   * @see {@link Executor.rawDelete}
   */
  rawDelete(sql: string, opts?: BatchArgs): BatchExecutor;

  /**
   * Add a DELETE command to the batch
   *
   * @see {@link Executor.delete}
   */
  delete(table: string, opts?: BatchDeleteArgs): BatchExecutor;

  /**
   * Add a UPDATE command to the batch
   * @see {@link Executor.rawUpdate}
   */
  rawUpdate(sql: string, opts?: BatchArgs): BatchExecutor;

  /**
   * Add a UPDATE command to the batch
   *
   * @see {@link Executor.update}
   */
  update(
    table: string,
    values: Record<string, any>,
    opts?: BatchUpdateArgs,
  ): BatchExecutor;

  /**
   * Add a SELECT command to the batch
   *
   * @see {@link Executor.query}
   */
  query(table: string, opts?: BatchArgs): BatchExecutor;
  /**
   * Add a SELECT command to the batch
   *
   * @see {@link Executor.rawQuery}
   */
  rawQuery(sql: string, opts?: BatchQueryArgs): BatchExecutor;
  /**
   * Add a SELECT command to the batch
   *
   * @see {@link Executor.queryEntries}
   */
  queryEntries(table: string, opts?: BatchArgs): BatchExecutor;
  /**
   * Add a SELECT command to the batch
   *
   * @see {@link Executor.rawQueryEntries}
   */
  rawQueryEntries(sql: string, opts?: BatchQueryArgs): BatchExecutor;

  /**
   * Prepares the given SQL query, so that it
   * can be run multiple times and potentially
   * with different parameters.
   *
   * @see {@link Executor.prepare}
   */
  prepare(sql: string, opts?: BatchNameArgs): BatchExecutor;
  /**
   * @see {@link Executor.prepareInsert}
   */
  prepareInsert(
    table: string,
    columns: Array<string> | Array<ColumnVar>,
    opts?: BatchPrepareInsertArgs,
  ): BatchExecutor;
  /**
   * @see {@link Executor.prepareDelete}
   */
  prepareDelete(
    table: string,
    opts?: BatchPrepareDeleteArgs,
  ): BatchExecutor;

  /**
   * @see {@link Executor.prepareUpdate}
   */
  prepareUpdate(
    table: string,
    columns: Array<string> | Array<ColumnVar>,
    opts?: BatchPrepareUpdateArgs,
  ): BatchExecutor;

  /**
   * @see {@link Executor.prepareQuery}
   */
  prepareQuery(table: string, opts?: BatchPrepareQueryArgs): BatchExecutor;
  /**
   * Add calls to the Prepare method to the batch
   * @see {@link Preparor}
   */
  method(
    preparor: Preparor,
    method: Method,
    opts?: BatchArgs,
  ): BatchExecutor;
}
