import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.endsWith(".js") && (specifier.startsWith("./") || specifier.startsWith("../"))) {
      try {
        return nextResolve(specifier, context);
      } catch (err) {
        if (
          err &&
          typeof err === "object" &&
          "code" in err &&
          err.code === "ERR_MODULE_NOT_FOUND"
        ) {
          return nextResolve(specifier.slice(0, -3) + ".ts", context);
        }
        throw err;
      }
    }
    return nextResolve(specifier, context);
  },
});
