# React Dashboard SPA: Architecture Reference

This document describes how to build a data heavy React dashboard. It covers the
stack, the folder layout, and the conventions that keep the code consistent as it
grows. The content is not tied to one product. Replace the domains and the
endpoints with your own.

This shape works for a few hundred to about 1000 source files. It also works for
dozens of CRUD surfaces over one API, for role based access, and for one bundle.

---

## 1. The stack

### 1.1 Core

| Layer | Choice | Notes |
| --- | --- | --- |
| Language | TypeScript (strict) | `strict`, `noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax` |
| UI | React 19 | React Compiler |
| Bundler and dev server | Vite | `@vitejs/plugin-react` |
| Routing | TanStack Router | |
| Server state | TanStack Query | One query client. Configure it in one place |
| Client state | Zustand | Keep this small. A few stores only |
| URL state | nuqs | Pagination, filters, and sorting live in the URL |
| HTTP | axios | One instance with interceptors |
| Forms | react-hook-form + zod | Through `@hookform/resolvers` |
| Components | Mantine | Ready made component library, installed from npm |
| Lint and format | Biome | Biome replaces ESLint and Prettier with one binary |

The three way split of state is the load bearing decision:

- Server state belongs in TanStack Query.
- Shareable view state belongs in the URL.
- All remaining state belongs in Zustand.

Apply one test. If a user can link to a piece of state, or can refresh the page
into it, put that state in the URL. Do not put it in a store.

### 1.2 Common utility layer

Use `date-fns` for dates. Use `immer` for immutable updates.

---

## 2. Top level layout

```
project/
├── src/                     # all application code (see §3)
├── assets/                  # build-time source assets (compiled, not served)
├── public/                  # static files served as-is
├── plugins/                 # project-specific Vite plugins
├── scripts/                 # repo shell scripts (checks, codegen wrappers)
├── docs/                    # long-form docs for non-obvious subsystems
├── .github/workflows/       # CI
├── AGENTS.md                # coding conventions, the authority
├── vite.config.ts
├── biome.json
└── tsconfig.{json,app.json,node.json}
```

`AGENTS.md` is the authority on coding conventions. Read it before you change
code. Section 4 of this document lists the conventions to put there.

---

## 3. The `src/` layout

```
src/
├── main.tsx           # entry: error tracking, providers, router mount
├── api/               # generated client, if one exists. Do not hand-edit
├── router/            # route table, guards, loaders, middlewares
├── layouts/           # page shells
├── pages/             # route components (thin)
├── features/          # the bulk of the app, grouped by domain
├── components/        # shared, cross-feature UI
├── hooks/             # shared, cross-feature hooks
├── lib/               # framework-agnostic helpers and singletons
├── stores/            # client-state stores
├── constants/         # static data and copy
├── config/            # defaults for shared systems
├── types/             # shared type helpers
├── hocs/              # the rare higher-order component
└── styles/            # app-level stylesheets (the page frame, print)
```

One test separates `features/` from the shared top level folders. Ask whether
more than one domain uses the code. Single domain code stays in its feature
folder. This rule holds even when a component looks shared.

### 3.1 API access with tRPC

Call the backend through tRPC. tRPC infers the types from the server router, so
this project has no code generation step and no generated client to keep in
sync. Keep the `api/` folder only if a generated REST client also exists for a
service that tRPC does not cover. Never hand edit a generated file.

The hook rules below describe the same pattern as a generated REST client. Read
"generated options factory" as "the tRPC procedure helper".

### 3.2 `src/features/<domain>/`, the main body of the app

Create one folder for each product domain. Give every folder the same internal
shape. Add only the parts that the domain needs.

```
features/<domain>/
├── hooks/         # one thin hook per endpoint: use-<verb>-<resource>.ts
├── components/    # domain UI: tables, dialogs, forms, widgets
├── constants/     # domain enums, labels, column definitions
├── helpers/       # pure functions
└── lib/           # domain-specific singletons (rare)
```

The hook layer is the most important pattern. Follow these rules:

1. For a query, wrap the procedure helper, for example
   `trpc.widgets.list.queryOptions(input)`. Take one `options` argument. Type
   that argument from the procedure input type. Callers then pass the exact
   shape that the API declares.
2. For a mutation, spread the procedure mutation helper. Add a success toast.
   Add an error toast that reads from a per endpoint error map. Type that map
   from the procedure error codes. A backend rename then becomes a type error
   instead of a silent fallback.
3. Put the cache work in `onSettled`, not in `onSuccess`. The cache is then
   correct whether or not the request succeeded.
4. Build cache keys from the tRPC key helpers, for example
   `trpc.widgets.list.queryKey()`. Never write a key array by hand. Add the
   mutation `variables` to the key where the key needs them.
5. Call `invalidateQueries` for lists that are on screen.
6. Call `removeQueries` for the get-by-id query of the edited resource.
   Reopening an edit form then waits for fresh data. Without this step the form
   paints stale values for one frame.
7. If an action consumes a quota, also invalidate the endpoint that reports
   usage.

Write one thin hook for each endpoint. Reuse that hook at the component level.
Do not write generic hook factories. A factory saves a few lines. It also costs
you the ability to special case a single endpoint.

### 3.3 `src/components/`, shared UI

```
components/
├── layout/             # sidebar, header, nav items, nav user, tenant switcher
└── *.tsx               # one-off shared widgets
```

The primitives come from Mantine, so nothing is vendored here. Use a Mantine
component directly at the call site. Do not wrap one in a pass-through
component; add a local component only when it carries behavior of its own.

### 3.4 `src/lib/`, singletons and pure helpers

| File | Role |
| --- | --- |
| `axios.ts` | The HTTP instance. Interceptors inject auth and cross-cutting behavior |
| `query-client.ts` | The query client: stale time, retry policy, refetch behavior |
| `env.ts` | Environment variables parsed through a zod schema. Fails fast at boot |
| `utils.ts` | `cn()` and the shared error-toast helpers |
| `data-table.ts`, `parsers.ts` | Table state to URL serialization, and back |
| `format.ts`, `number.ts`, `object.ts`, `url.ts`, `file.ts`, `regex.ts` | Small pure helpers |

Copy these two details into every project:

1. Parse the environment with a schema at module load. A missing variable then
   becomes a clear boot time error. Without this step `undefined` appears three
   screens deep.
2. Put cross-cutting request behavior in interceptors. Do not put it in call
   sites. Auth headers belong there. So does 429 handling. So does an
   artificial minimum request duration, which stops a fast response from
   flashing a skeleton. A `sleep()` at each call site is the version that
   someone forgets half of the time.

### 3.5 `src/stores/`, client state

Keep this folder small. Be suspicious when it grows. Only three kinds of state
belong here:

1. The auth session. Persist it. Clear the query cache on login and on logout.
2. Dismissible UI state.
3. Hand-offs across a redirect, for example OAuth state.

All other state is server state or URL state.

### 3.6 `src/hooks/`, cross-feature hooks

This folder holds the table engine, the role hook, and quota and usage hooks. It
also holds a deployed version check that asks stale tabs to reload, theme
switching, file upload, debounce, clipboard, viewport, and relative time.

### 3.7 `src/types/`

Keep this folder small. It holds the helper types that the hook pattern needs,
such as an error map type and a "request options without the URL" type. It also
holds module augmentations for the axios config, and the shared table types.

Sometimes a generated type loses information that the real contract carries.
Literal unions often arrive as `string`. Fields with server defaults often
arrive optional. Narrow such a type at the boundary with `Omit`. Do not restate
the whole type.

```ts
export type Widget = Omit<GeneratedWidget, "status" | "tags"> & {
	status: "active" | "paused" | "failed"
	tags: string[]
}
```

Narrow the type once. Add a comment that says why. Do not scatter `?? []` and
casts through every consumer.

---

## 4. Conventions to enforce

1. **Prefer generated types to hand written types.** Narrow a generated type
   with `Omit` at the boundary when it loses information that the contract
   carries.
2. **Declare components as `const X: FunctionComponent<Props>`.** Declare the
   `Props` type directly above the component. Name it `Props`, because the name
   is file scoped. Where an existing file differs, match that file. Do not
   convert it.
3. **Handle three outcomes on every data surface: pending, error, and loaded
   but empty.** Two failures are common. A screen renders nothing while it
   waits. A screen says "no results" when the request failed.
   - Branch on `isPending`. `isPending` is true whenever no data exists to
     render, which is what a skeleton is for. `isLoading` equals
     `isPending && isFetching`, so it turns false for a paused query or a
     disabled query and leaves the surface blank. `isFetching` includes
     background refetches, so a branch on `isFetching` flashes a skeleton over
     data that the reader already reads.
   - For the pending state, show a skeleton in the shape of the content that it
     replaces. Do not show a spinner. Give a table skeleton the real column
     count. Give it a row count that matches the page size. The layout then
     does not jump when the data lands.
   - For the error state, say what failed. Write copy that is specific to the
     surface. Offer a retry that calls the query `refetch`. Do not reload the
     page.
   - For the empty state, separate two cases. "Nothing yet" explains how a
     first item appears. "No matches" names the filters, because the filters
     are the fix. Build both cases from one set of `Empty` primitives. Every
     empty surface in the app then aligns the same way.
4. **Do not delete comments.** A comment carries the reason for the code, which
   is usually the bug or the constraint that produced it. The diff does not
   carry that reason. Move a comment with its code. If your change makes a
   comment false, rewrite the comment in the same commit. A comment that
   describes behavior the code no longer has is worse than no comment.
5. **Make surgical changes.** Trace every changed line back to the request. Do
   not improve nearby code, comments, or formatting. Do not refactor working
   code. Match the existing style, even where you prefer another style. Remove
   the orphaned imports and variables that your own change created. Report
   unrelated dead code instead of deleting it.
6. **Choose the simple option first.** Add no feature beyond the request. Add no
   abstraction for single use code. Add no option that nobody asked for. Add no
   error handling for impossible states. If 200 lines fit in 50 lines, rewrite
   them.
7. **Think before you write code.** State your assumptions. If a request has
   several readings, report them. Do not pick one reading in silence. If a
   simpler approach exists, say so.
