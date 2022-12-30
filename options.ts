import { Context } from "./deps/easyts/context/mod.ts";
import { QueryParameterSet } from "./sqlite.ts";
export interface ContextOptions {
  /**
   * like golang Context
   *
   * @see {@link https://powerpuffpenguin.github.io/ts/easyts/interfaces/context_mod.Context.html}
   */
  ctx?: Context;
}
export interface ArgsOptions extends ContextOptions {
  /**
   * Parameters bound to sql
   */
  args?: QueryParameterSet;
}
