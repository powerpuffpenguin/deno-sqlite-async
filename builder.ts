import { QueryParameter } from "./sqlite.ts";
import { Conflict } from "./executor.ts";
export class Builder {
  private sql_: Array<string> = [];
  private args_: Array<QueryParameter> = [];
  sql(): string {
    return this.sql_.join("");
  }
  args() {
    return this.args_.length != 0 ? this.args_ : undefined;
  }
  insert(table: string, values: Record<string, any>, conflict?: Conflict) {
    const sql = this.sql_;
    switch (conflict) {
      case Conflict.rollback:
        sql.push(`INSERT OR ROLLBACK ${table}`);
        break;
      case Conflict.abort:
        sql.push(`INSERT OR ABORT ${table}`);
        break;
      case Conflict.fail:
        sql.push(`INSERT OR FAIL ${table}`);
        break;
      case Conflict.ignore:
        sql.push(`INSERT OR IGNORE ${table}`);
        break;
      case Conflict.replace:
        sql.push(`INSERT OR REPLACE ${table}`);
        break;
      default:
        sql.push(`INSERT ${table}`);
        break;
    }
  }
}
