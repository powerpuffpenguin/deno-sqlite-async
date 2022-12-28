import { Context } from "./deps/easyts/context/mod.ts";
import { QueryParameterSet } from "./sqlite.ts";
export interface ContextOptions {
  ctx?: Context;
}
export interface ArgsOptions extends ContextOptions {
  args?: QueryParameterSet;
}
