---
title: File uploads
description: "multipart parsing via the optional busboy peer dependency."
---

A request with `Content-Type: multipart/form-data` makes `@body()` resolve to `{ fields, files }` instead of a plain object.

:::caution[multipart needs the optional `busboy` peer]
Multipart parsing uses the optional [`busboy`](https://github.com/mscdex/busboy) peer dependency — install it with `npm i busboy`. A `multipart/form-data` request to a server without busboy installed returns **`501`**. (JSON and urlencoded need nothing extra.)
:::

```typescript
import { Route, Post, body } from '@green-tea/core';
import type { MultipartBody } from '@green-tea/core';

@Route('/profile')
class ProfileController {
  @Post('/avatar')
  upload(@body() form: MultipartBody) {
    const name = form.fields.name;         // string | string[]
    const avatar = form.files.avatar;      // UploadedFile | UploadedFile[]
    return { name, size: Array.isArray(avatar) ? undefined : avatar?.size };
  }
}
```

`UploadedFile` is `{ filename, contentType, data: Buffer, size }` — the whole file is buffered in memory, no temp files.

:::note[Access asymmetry]
For multipart, `@body('title')` returns `undefined` — the value lives at `body.fields.title`, not `body.title`, unlike JSON/urlencoded where `@body('title')` picks the value directly. Use `@body()` and read `.fields`/`.files`, or key into the envelope itself with `@body('fields')` / `@body('files')`. See [arguments](/docs/guides/arguments/) for how `@body()` behaves across content types.
:::

## Repeated fields — `bodyDuplicates`

By default, a repeated field name keeps the **last** value (`'last'`, matching urlencoded). Set `bodyDuplicates: 'array'` on `createApp` to accumulate repeats into a `string[]` instead — this applies to **both** urlencoded and multipart text fields:

```typescript
const app = createApp({ modules: [ApiModule], bodyDuplicates: 'array' });
```

Files under a repeated field name always become an array (`UploadedFile[]`), regardless of `bodyDuplicates`.

## Per-endpoint override

```typescript
@Post('/upload', { duplicates: 'array' })
upload(@body() form: MultipartBody) { /* ... */ }
```

Precedence: route `duplicates` → app `bodyDuplicates` → `'last'`.

## Limits

Uploaded files are held in memory, so they're bounded by the same `maxBodyBytes` limit as any other request body (over the limit → **413**). `maxParts` (default `1000`) caps the number of multipart parts per request:

```typescript
const app = createApp({ modules: [ApiModule], limits: { maxParts: 500 } });
```

Both limits can be overridden **per route** — an upload endpoint can allow a larger body than the rest of the API:

```typescript
@Post('/avatar', { maxBodyBytes: 5_000_000, maxParts: 20 })
uploadAvatar(@body() form: MultipartBody) { /* ... */ }
```

A route's `maxBodyBytes` / `maxParts` fall back to the server-wide `limits` when unset. A malformed multipart body (bad boundary, missing headers, truncated part) → **400**.

### When the limit is checked

`maxBodyBytes` is enforced while the body arrives, not after, on Node, Deno, Bun and the edge alike:

- A `Content-Length` that already declares more than the limit is refused with `413` before any of
  the body is read.
- Otherwise the body is read chunk by chunk, and reading stops at the chunk that crosses the limit.
  The rest of the upload is not pulled, so a 10 GB upload is not buffered before it is refused. On
  Deno, Bun and the edge, a well-formed `Content-Length` within the limit is read in one
  `arrayBuffer()` instead, because the runtime frames the body by that header; only a chunked upload
  takes the chunk-by-chunk read.
- A malformed or absent `Content-Length` proves nothing and is ignored. The running count enforces
  the limit either way.

The `413` is the same in every case and goes through [`onError`](/docs/guides/errors/), with the same
route-over-server precedence for `maxBodyBytes` and `maxParts`. On workerd, which may drop
`Content-Length` from a chunked upload, an oversized body is refused by the count instead of up
front. Only how early the `413` comes differs.

:::note
To validate parsed fields against a schema, pass a Standard Schema to `@body()` — see [validation](/docs/guides/validation/).
:::
