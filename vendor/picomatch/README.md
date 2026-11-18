# GSTD Picomatch fork

This is a local, MIT-licensed fork of Picomatch 4.0.7. The upstream npm archive has integrity `sha512-qcJu88Q2IWqJsDD529JKMdwGm/dvInW4HvQnRwiH9JtihJvzGOscDtHE3x1pBKeUOTysQ8kVmLnJ2kJu7yhcGA==`.

The parser addresses [GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf) at repeated extglob compilation. Repeated groups accept nonempty literal alternatives with no overlapping prefixes. Existing safe single-character star sequences still collapse to a character class. Other repeated bodies throw a SyntaxError. Quoted and escaped repeated bodies are rejected because parser options can change their interpretation. The safety check also applies with `maxExtglobRecursion: false`.

Other matcher APIs and ordinary glob patterns retain upstream behavior. The repository uses ordinary source/test filename globs. Generic callers that require repeated wildcard extglobs must revise their pattern before adopting this fork.

Case-insensitive literal alternatives are compared after ASCII case folding. Case-insensitive repeated groups with non-ASCII literals are rejected, because their equivalence depends on JavaScript Unicode regex flags.

Repeated bodies with whitespace, control characters or quoted/escaped syntax are rejected before parser normalization. Character-class rewrites exclude path separators. Raw regex-style `+` after a closing group is also rejected, so an outer regex group cannot reintroduce nested repetition around a safe extglob.

The npm override resolves every Picomatch dependency to this source, including test and compiler dependencies that formerly used version 2. The installation check verifies the lockfile and the actual module resolution of installed consumers. The registry audit runs alongside these checks. A local package has no upstream registry advisory identity, so an audit result alone cannot verify this patch.

Upstream files retain their MIT license. The functional changes are limited to `lib/parse.js`, and package metadata identifies this fork explicitly.
