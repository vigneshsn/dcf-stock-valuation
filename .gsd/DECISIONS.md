# Decisions Register

<!-- Append-only. Never edit or remove existing rows.
     To reverse a decision, add a new row that supersedes it.
     Read this file at the start of any planning or research phase. -->

| # | When | Scope | Decision | Choice | Rationale | Revisable? | Made By |
| --- | --- | --- | --- | --- | --- | --- | --- |
| D001 |  | architecture | Where and how to host the new backend proxy alongside the existing Angular CLI app | Standalone Express + TypeScript project in a new server/ directory (own package.json, tsconfig.json, port 3000), independent of the Angular build/lint/test pipeline | Repo currently has zero backend scaffolding; isolating the proxy in server/ avoids interfering with ng build/lint/test and matches TS conventions already used by the Angular app | true | agent |
