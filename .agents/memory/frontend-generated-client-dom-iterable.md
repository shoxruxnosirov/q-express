---
name: Generated client DOM iterable support
description: TypeScript configuration needed for generated fetch helpers that iterate Headers.
---

Generated API clients in this workspace may use `Headers.entries()`. The client library TypeScript config must include `dom.iterable` alongside `dom` or the generated code fails the library typecheck.

**Why:** The generated client includes fetch error serialization that iterates response headers, while the shared base config only targets ES libraries.

**How to apply:** Keep `dom.iterable` in the generated client package's `lib` list after every codegen or package scaffold change.