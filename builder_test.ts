import { assertEquals, assertFalse } from "./deps/std/testing/asserts.ts";
import { PrepareBuilder } from "./builder.ts";
Deno.test("matchName", () => {
  const matchName = /^[a-zA-Z][a-z\_A-Z0-9]*$/;

  assertFalse(matchName.test("0"));
  assertFalse(matchName.test("_"));
  assertFalse(!matchName.test("a"));
  assertFalse(!matchName.test("a_"));
  assertFalse(!matchName.test("a_0"));
  assertFalse(!matchName.test("a_0z"));

  assertFalse(matchName.test("a_#0z"));
});
Deno.test("PrepareBuilder", () => {
  let b = new PrepareBuilder();
  b.insert("a", ["b", "c"]);
  assertEquals(b.sql(), `INSERT INTO a (b, c) VALUES (?, ?)`);

  b = new PrepareBuilder();
  b.insert("a", [{ name: "b", var: "b" }, { name: "c", var: "c" }]);
  assertEquals(b.sql(), `INSERT INTO a (b, c) VALUES (:b, :c)`);
});
