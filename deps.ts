interface Dependency {
  name: string;
  url: string;
  mod: Array<string>;
}

function define(name: string, url: string, mod: Array<string>): Dependency {
  return {
    name: name,
    url: url,
    mod: mod,
  };
}
async function deps(output: string, ...deps: Array<Dependency>) {
  if (output == "") {
    output = "./";
  } else if (Deno.build.os == "windows") {
    if (!output.endsWith("\\") && !output.endsWith("/")) {
      output += "\\";
    }
  } else if (!output.endsWith("/")) {
    output += "/";
  }

  for (const dep of deps) {
    console.log(`dependency: ${dep.name} from ${dep.url}`);
    const dir = `${output}${dep.name}`;
    await Deno.mkdir(dir, { recursive: true });
    for (const mode of dep.mod) {
      console.log(` - ${mode}`);
      const found = mode.lastIndexOf("/");
      if (found) {
        await Deno.mkdir(`${dir}/${mode.substring(0, found)}`, {
          recursive: true,
        });
      }
      await Deno.writeTextFile(
        `${dir}/${mode}`,
        `export * from "${dep.url}/${mode}";`,
      );
    }
  }
}

deps(
  "deps",
  define("std", "https://deno.land/std@0.167.0", [
    "testing/asserts.ts",
  ]),
  define(
    "easyts",
    "https://deno.land/x/easyts@0.1.1",
    [
      "mod.ts",
      "context/mod.ts",
      "sync/mod.ts",
    ],
  ),
  define(
    "sqlite",
    "https://deno.land/x/sqlite@v3.7.0",
    [
      "mod.ts",
    ],
  ),
);
