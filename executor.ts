// deno-lint-ignore-file no-explicit-any
import { Context } from "./deps/easyts/context/mod.ts";
import { QueryParameterSet, Row, RowObject } from "./sqlite.ts";
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

export interface Options {
  ctx?: Context;
  lock?: Locker;
}
export interface ExecuteOptions extends Options {
  args?: QueryParameterSet;
}

export interface InsertOptions extends Options {
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
export interface UpdateOptions extends ExecuteOptions {
  where?: string;
  conflict?: Conflict;
}
export interface DeleteOptions extends ExecuteOptions {
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

  /**
   * Creates a batch, used for performing multiple operation
   * in a single atomic operation.
   *
   * a batch can be commited using [Batch.commit]
   *
   * If the batch was created in a transaction, it will be commited
   * when the transaction is done
   */
  batch(): Batch;
}

export interface BatchExecuteOptions {
  args?: QueryParameterSet;
}

export interface BatchInsertOptions {
  conflict?: Conflict;
}
export interface BatchQueryOptions extends BatchExecuteOptions {
  distinct?: boolean;
  columns?: Array<string>;
  where?: string;
  groupBy?: string;
  having?: string;
  orderBy?: string;
  limit?: number | bigint;
  offset?: number | bigint;
}
export interface BatchUpdateOptions extends BatchExecuteOptions {
  where?: string;
  conflict?: Conflict;
}
export interface BatchDeleteOptions extends BatchExecuteOptions {
  where?: string;
}
export interface BatchCommit {
  ctx: Context;
}
export interface Batch {
  commit(opts?: BatchCommit): Array<Array<Row | RowObject>>;

  /**
   * @see {@link Executor.rawInsert}
   */
  rawInsert(sql: string, opts?: BatchExecuteOptions): void;

  /**
   * @see {@link Executor.insert}
   */
  insert(table: string, opts?: BatchInsertOptions): void;

  /**
   * @see {@link Executor.rawUpdate}
   */
  rawUpdate(sql: string, opts?: BatchExecuteOptions): void;

  /**
   * @see {@link Executor.update}
   */
  update(
    table: string,
    values: Record<string, any>,
    opts?: BatchUpdateOptions,
  ): void;

  /**
   * @see {@link Executor.rawDelete}
   */
  rawDelete(sql: string, opts?: BatchExecuteOptions): void;

  /**
   * @see {@link Executor.delete}
   */
  delete(table: string, opts: BatchDeleteOptions): void;

  /**
   * @see {@link Executor.execute}
   */
  execute(sql: string, opts: BatchDeleteOptions): void;

  /**
   * @see {@link Executor.query}
   */
  query(table: string, opts?: BatchQueryOptions): void;
  /**
   * @see {@link Executor.rawQuery}
   */
  rawQuery(sql: string, opts?: BatchExecuteOptions): void;
}
