// deno-lint-ignore-file no-explicit-any
import { QueryParameter, QueryParameterSet, SqliteError } from "./sqlite.ts";
import {
  Conflict,
  DeleteOptions,
  PrepareDeleteOptions,
  PrepareQueryOptions,
  PrepareUpdateOptions,
  QueryOptions,
  UpdateOptions,
} from "./executor.ts";
export const escapeNames = new Set<string>();
escapeNames.add("add");
escapeNames.add("all");
escapeNames.add("alter");
escapeNames.add("and");
escapeNames.add("as");
escapeNames.add("autoincrement");
escapeNames.add("between");
escapeNames.add("case");
escapeNames.add("check");
escapeNames.add("collate");
escapeNames.add("commit");
escapeNames.add("constraint");
escapeNames.add("create");
escapeNames.add("default");
escapeNames.add("deferrable");
escapeNames.add("delete");
escapeNames.add("distinct");
escapeNames.add("drop");
escapeNames.add("else");
escapeNames.add("escape");
escapeNames.add("except");
escapeNames.add("exists");
escapeNames.add("foreign");
escapeNames.add("from");
escapeNames.add("group");
escapeNames.add("having");
escapeNames.add("if");
escapeNames.add("in");
escapeNames.add("index");
escapeNames.add("insert");
escapeNames.add("intersect");
escapeNames.add("into");
escapeNames.add("is");
escapeNames.add("isnull");
escapeNames.add("join");
escapeNames.add("limit");
escapeNames.add("not");
escapeNames.add("notnull");
escapeNames.add("null");
escapeNames.add("on");
escapeNames.add("or");
escapeNames.add("order");
escapeNames.add("primary");
escapeNames.add("references");
escapeNames.add("select");
escapeNames.add("set");
escapeNames.add("table");
escapeNames.add("then");
escapeNames.add("to");
escapeNames.add("transaction");
escapeNames.add("union");
escapeNames.add("unique");
escapeNames.add("update");
escapeNames.add("using");
escapeNames.add("values");
escapeNames.add("when");
escapeNames.add("where");
export function escapeName(name: string): string {
  if (escapeNames.has(name.toLowerCase())) {
    return `"${name}"`;
  }
  return name;
}
function buildQuery(table: string, opts?: PrepareQueryOptions): string {
  const groupBy = opts?.groupBy ?? "";
  const having = opts?.having ?? "";
  if (groupBy === "" && having !== "") {
    throw new SqliteError(
      "HAVING clauses are only permitted when using a groupBy clause",
    );
  }
  const sql = new Array<string>();
  sql.push("SELECT ");
  if (opts?.distinct) {
    sql.push("DISTINCT ");
  }
  const columns = opts?.columns;
  const len = columns?.length ?? 0;
  if (len == 0) {
    sql.push("* ");
  } else {
    for (let i = 0; i < len; i++) {
      if (i == 0) {
        sql.push(escapeName(columns![i]));
      } else {
        sql.push(`, ${escapeName(columns![i])}`);
      }
    }
    sql.push(" ");
  }
  sql.push(` FROM ${escapeName(table)}`);
  const where = opts?.where ?? "";
  if (where != "") {
    sql.push(` WHERE ${where}`);
  }
  if (groupBy != "") {
    sql.push(` GROUP BY ${groupBy}`);
  }
  if (having != "") {
    sql.push(` HAVING ${having}`);
  }
  const orderBy = opts?.orderBy ?? "";
  if (orderBy != "") {
    sql.push(` ORDER BY ${orderBy}`);
  }
  const limit = opts?.limit ?? 0;
  if (limit > 0) {
    sql.push(` LIMIT ${limit}`);
  }
  const offset = opts?.offset ?? 0;
  if (offset > 0) {
    sql.push(` OFFSET ${offset}`);
  }

  return sql.join("");
}
const matchName = /^[a-z][a-z\_0-9]*$/;
function formatVarName(name: string) {
  if (name.startsWith(":")) {
    const str = name.substring(1).toLocaleLowerCase();
    if (escapeNames.has(name) || !matchName.test(str)) {
      throw new SqliteError(
        `var name '${name}' not supported`,
      );
    }
    return name;
  }
  const str = name.toLocaleLowerCase();
  if (escapeNames.has(str) || !matchName.test(str)) {
    throw new SqliteError(
      `var name '${name}' not supported`,
    );
  }
  return `:${name}`;
}
export class Builder {
  private sql_ = "";
  private args_?: QueryParameterSet;
  sql(): string {
    return this.sql_;
  }
  args() {
    return this.args_;
  }
  insert(table: string, values: Record<string, any>, conflict?: Conflict) {
    const sql = new Array<string>();
    switch (conflict) {
      case Conflict.rollback:
        sql.push(`INSERT OR ROLLBACK INTO ${escapeName(table)} (`);
        break;
      case Conflict.abort:
        sql.push(`INSERT OR ABORT INTO ${escapeName(table)} (`);
        break;
      case Conflict.fail:
        sql.push(`INSERT OR FAIL INTO ${escapeName(table)} (`);
        break;
      case Conflict.ignore:
        sql.push(`INSERT OR IGNORE INTO ${escapeName(table)} (`);
        break;
      case Conflict.replace:
        sql.push(`INSERT OR REPLACE INTO ${escapeName(table)} (`);
        break;
      default:
        sql.push(`INSERT INTO ${escapeName(table)} (`);
        break;
    }
    const binds = new Array<QueryParameter>();
    let i = 0;
    for (const key in values) {
      if (Object.prototype.hasOwnProperty.call(values, key)) {
        binds.push(values[key]);
        sql.push(i == 0 ? escapeName(key) : `, ${escapeName(key)}`);
        i++;
      }
    }
    sql.push(") VALUES (");
    i = 0;
    const args = new Array<QueryParameter>();
    for (const arg of binds) {
      if (arg === undefined || arg === null) {
        sql.push(i == 0 ? "NULL" : ", NULL");
      } else {
        sql.push(i == 0 ? "?" : ", ?");
        args.push(arg);
      }
      i++;
    }
    sql.push(")");

    if (args.length != 0) {
      this.args_ = args;
    }
    this.sql_ = sql.join("");
  }
  query(table: string, opts?: QueryOptions) {
    const args = opts?.args;
    if (!Array.isArray(args) || args.length != 0) {
      this.args_ = args;
    }
    this.sql_ = buildQuery(table, opts);
  }
  update(table: string, values: Record<string, any>, opts?: UpdateOptions) {
    const args = new _Parameter(opts?.args);
    const sql = new Array<string>();
    switch (opts?.conflict) {
      case Conflict.rollback:
        sql.push(`UPDATE OR ROLLBACK ${escapeName(table)} SET `);
        break;
      case Conflict.abort:
        sql.push(`UPDATE OR ABORT ${escapeName(table)} SET `);
        break;
      case Conflict.fail:
        sql.push(`UPDATE OR FAIL ${escapeName(table)} SET `);
        break;
      case Conflict.ignore:
        sql.push(`UPDATE OR IGNORE ${escapeName(table)} SET `);
        break;
      case Conflict.replace:
        sql.push(`UPDATE OR REPLACE ${escapeName(table)} SET `);
        break;
      default:
        sql.push(`UPDATE ${escapeName(table)} SET `);
        break;
    }
    let i = 0;
    for (const key in values) {
      if (Object.prototype.hasOwnProperty.call(values, key)) {
        const arg = values[key];
        if (arg === undefined || arg === null) {
          sql.push(
            i == 0
              ? `${escapeName(key)} = NULL`
              : `, ${escapeName(key)} = NULL`,
          );
        } else {
          const name = args.push(arg) ?? "?";
          sql.push(
            i == 0
              ? `${escapeName(key)} = ${name}`
              : `, ${escapeName(key)} = ${name}`,
          );
        }
        i++;
      }
    }

    const where = opts?.where ?? "";
    if (where != "") {
      sql.push(` WHERE ${where}`);
    }

    this.args_ = args.args();
    this.sql_ = sql.join("");
  }
  delete(table: string, opts?: DeleteOptions) {
    const where = opts?.where ?? "";

    this.args_ = opts?.args;
    this.sql_ = where == ""
      ? `DELETE FROM ${escapeName(table)}`
      : `DELETE FROM ${escapeName(table)} WHERE ${where}`;
  }
}
class _Parameter {
  private i = 0;
  private keys_?: Record<string, QueryParameter>;
  private args_?: Array<QueryParameter>;
  private values_?: Array<QueryParameter>;
  constructor(values?: QueryParameterSet) {
    if (values === null || values === undefined || Array.isArray(values)) {
      this.values_ = values;
    } else {
      const keys: Record<string, QueryParameter> = {};
      let ok = false;
      for (const key in values) {
        if (Object.prototype.hasOwnProperty.call(values, key)) {
          keys[key] = values[key];
          ok = true;
        }
      }
      if (ok) {
        this.keys_ = keys;
      }
    }
  }
  push(arg: QueryParameter): string | undefined {
    const keys = this.keys_;
    if (keys) {
      return this._set(arg);
    } else {
      if (this.args_) {
        this.args_.push(arg);
      } else {
        this.args_ = [arg];
      }
    }
  }
  private _set(val: QueryParameter): string {
    const keys = this.keys_!;
    let key: string;
    while (true) {
      key = `arg_${this.i++}`;
      if (!Object.prototype.hasOwnProperty.call(keys, key)) {
        keys[key] = val;
        return `:${key}`;
      }
    }
  }
  args(): QueryParameterSet | undefined {
    const keys = this.keys_;
    if (keys) {
      return keys;
    } else {
      const args = this.args_;
      if (!args) {
        return this.values_;
      } else if (this.values_) {
        args.push(...this.values_);
      }
      return args;
    }
  }
}
export interface ColumnVar {
  name: string;
  var: string;
}

export class PrepareBuilder {
  private sql_ = "";
  sql(): string {
    return this.sql_;
  }
  insert(
    table: string,
    columns: Array<string> | Array<ColumnVar>,
    conflict?: Conflict,
  ) {
    const len = columns.length;
    if (len == 0) {
      throw new SqliteError(
        `columns.length == 0`,
      );
    }
    const isString = typeof columns[0] === "string";

    const sql = new Array<string>();
    switch (conflict) {
      case Conflict.rollback:
        sql.push(`INSERT OR ROLLBACK INTO ${escapeName(table)} (`);
        break;
      case Conflict.abort:
        sql.push(`INSERT OR ABORT INTO ${escapeName(table)} (`);
        break;
      case Conflict.fail:
        sql.push(`INSERT OR FAIL INTO ${escapeName(table)} (`);
        break;
      case Conflict.ignore:
        sql.push(`INSERT OR IGNORE INTO ${escapeName(table)} (`);
        break;
      case Conflict.replace:
        sql.push(`INSERT OR REPLACE INTO ${escapeName(table)} (`);
        break;
      default:
        sql.push(`INSERT INTO ${escapeName(table)} (`);
        break;
    }
    let i = 0;
    for (const key of columns) {
      if (typeof key === "string") {
        if (!isString) {
          throw new SqliteError(
            "columns does not support mixing 'string' and 'ColumnVar'",
          );
        }
        sql.push(i == 0 ? escapeName(key) : `, ${escapeName(key)}`);
      } else {
        if (isString) {
          throw new SqliteError(
            "columns does not support mixing 'string' and 'ColumnVar'",
          );
        }
        sql.push(i == 0 ? escapeName(key.name) : `, ${escapeName(key.name)}`);
      }
      i++;
    }
    sql.push(") VALUES (");
    i = 0;
    for (const key of columns) {
      if (typeof key == "string") {
        if (!isString) {
          throw new SqliteError(
            "columns does not support mixing 'string' and 'ColumnVar'",
          );
        }
        sql.push(i == 0 ? "?" : ", ?");
      } else {
        if (isString) {
          throw new SqliteError(
            "columns does not support mixing 'string' and 'ColumnVar'",
          );
        }
        const name = formatVarName(key.var);
        sql.push(i == 0 ? name : `, ${name}`);
      }

      i++;
    }
    sql.push(")");

    this.sql_ = sql.join("");
  }
  query(table: string, opts?: PrepareQueryOptions) {
    this.sql_ = buildQuery(table, opts);
  }
  update(
    table: string,
    columns: Array<string> | Array<ColumnVar>,
    opts?: PrepareUpdateOptions,
  ) {
    const len = columns.length;
    if (len == 0) {
      throw new SqliteError(
        `columns.length == 0`,
      );
    }
    const isString = typeof columns[0] === "string";

    const sql = new Array<string>();
    switch (opts?.conflict) {
      case Conflict.rollback:
        sql.push(`UPDATE OR ROLLBACK ${escapeName(table)} SET `);
        break;
      case Conflict.abort:
        sql.push(`UPDATE OR ABORT ${escapeName(table)} SET `);
        break;
      case Conflict.fail:
        sql.push(`UPDATE OR FAIL ${escapeName(table)} SET `);
        break;
      case Conflict.ignore:
        sql.push(`UPDATE OR IGNORE ${escapeName(table)} SET `);
        break;
      case Conflict.replace:
        sql.push(`UPDATE OR REPLACE ${escapeName(table)} SET `);
        break;
      default:
        sql.push(`UPDATE ${escapeName(table)} SET `);
        break;
    }
    let i = 0;
    for (const key of columns) {
      if (typeof key === "string") {
        if (!isString) {
          throw new SqliteError(
            "columns does not support mixing 'string' and 'ColumnVar'",
          );
        }
        sql.push(
          i == 0 ? `${escapeName(key)} = ?` : `, ${escapeName(key)} = ?`,
        );
      } else {
        if (isString) {
          throw new SqliteError(
            "columns does not support mixing 'string' and 'ColumnVar'",
          );
        }
        const name = formatVarName(key.var);
        sql.push(
          i == 0
            ? `${escapeName(key.name)} = ${name}`
            : `, ${escapeName(key.name)} = ${name}`,
        );
      }
      i++;
    }

    const where = opts?.where ?? "";
    if (where != "") {
      sql.push(` WHERE ${where}`);
    }

    this.sql_ = sql.join("");
  }
  delete(table: string, opts?: PrepareDeleteOptions) {
    const where = opts?.where ?? "";

    this.sql_ = where == ""
      ? `DELETE FROM ${escapeName(table)}`
      : `DELETE FROM ${escapeName(table)} WHERE ${where}`;
  }
}
