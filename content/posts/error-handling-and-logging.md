+++
title = 'Error handling and logging in Express'
date = 2025-07-24T10:09:21+07:00
draft = false
[params]
  toc = true
+++

Error handling and logging is an essential part of any backend
application that can help reduce the time spent on debugging while
developing features, especially on production environment. Here are
some tips that I’ve gathered that I think can ease the process:

## Centralized error handling

Express supports middlewares out of the box which we can utilize to write
a centralized "catch-all" middleware to handle the errors without having
to explicitly writing try catch in every router handler. 

So instead of:

```ts
// router handler
async (req: Request, res: Response) {
  try {
    // logic
  } catch (err) {
    // do something here
  }
}
```

We can write a middleware to handle this:

```ts {hl_Lines=[17]}
function handleErrorMw(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) {
  // we can:
  // - log the error with additional metadata here
  // - serialize a consistent error response back to client
  // - custom errors
  // etc.
}

// app.js
app.use(mw1);
app.use(mw2);
app.use(handleErrorMw); // use this at the bottom the middleware stacks
```

Then, in route handler, we can omit the `try catch`. Starting with
Express 5, route handlers and middleware that return a Promise will call
`next(value)` automatically when they reject or throw an error. Refer to
the [express documentation](https://expressjs.com/en/guide/error-handling.html)
for more details on error handling.

For apps that still use v4, we can use the library
[express-async-errors](https://www.npmjs.com/package/express-async-errors)
to mitigate this:

```ts {hl_Lines=[1]}
import "express-async-errors"; // if v4

app.get(
  '/user/:id',
  async (req: Request, res: Response, next: NextFunction) => {
  // if getUserById fails, it will call next(err) automatically
    const user = await getUserById(req.params.id);
    res.json(user);
  }
)
```

This not only works with exceptions (database errors, logic errors, etc.)
but we can use them for validation or permission errors (we can create
custom errors for these, see the next section).

## Custom errors

Custom errors are a convenient way to categorize different types of errors
in our applications for better readability, maintainability as well as to
better express our intent. For most use cases, we have 2 types:

- Client errors: Errors from the client side, e.g. Bad Request, Forbidden
- Exceptions: Errors from our side: e.g. database errors, famous
`cannot read property of undefined` error, etc.

In TS (or JS), we have the class `Error` which can be used to extend our
custom error classes with additional information such as custom messages,
status code, detailed causes, etc. When debugging or testing, we get
useful stack traces and context when using structured errors instead of
opaque Error objects. And with a centralized error handler, we can create
our custom logic to handle the errors based on their concrete types.

An example of creating a custom Client Error:

```ts
class ClientError extends Error {
  statusCode: number;
  name: string;
  errors: unknown[];

  constructor(
    statusCode: number,
    message = "Something went wrong. Please try again later.",
    errors: unknown[] = [],
  ) {
    super(message);
    this.statusCode = statusCode;
    this.name = this.constructor.name;
    this.errors = errors;
    Error.captureStackTrace(this, this.constructor); // retain stack
  }
}

// we can then create custom errors like BadRequest, Forbidden, etc.

/**
 * Validation error, thrown when request data is invalid. Error code: 400
 */
export class ValidationError extends ClientError {
  constructor(message: string, errors?: unknown[]) {
    super(StatusCodes.BAD_REQUEST, message, errors);
  }
}

/**
 * Forbidden error, thrown when user does not have permission to access a resource. Error code: 403
 */
export class ForbiddenError extends ClientError {
  constructor(message: string, errors?: unknown[]) {
    super(StatusCodes.FORBIDDEN, message, errors);
  }
}
```

With the custom errors, we can call next or throw them in router handlers:

```ts
app.get(
  '/user/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    if (!hasPermissions) {
      return next(new ForbiddenError("message")) // better intent then just `throw Error`
    }
    //...
  }
)
```

## Stack trace

Stack trace is a core part in debugging and should not be overlooked.
It’s a report that shows where an error occurred in your code, including
the function call path that led to it.

Because of how important it is, we can (and should) log the stack trace
when developing for faster debugging. For development and staging
environment, we can also return the stack trace back to client so that
we don’t need to go on Cloud log and filter. 

__Important note: Returning stack trace should only be done in development
and staging environment, we don’t want to return stack trace in production
since it can leak our internal file structures__.

## Request ID

Logging errors won’t have much benefits if there isn’t a precise and fast
way to trace it, especially in production. We can use a request id, which
is basically a custom `uuid()` (or other custom implementation) that can
be attached to the request-response cycle.

In production environment, we don’t return the error internal details back to the users. By logging
errors with a request ID and including it in the response, it allows
clients to reference the ID when seeking support for issues, and allows
faster log filtering.

We can write a middleware to handle this:

```ts
export async function requestIdMiddleware (
  req: Request,
  res: Response,
  next: NextFunction,
) {
  req.id = uuidv4();
  res.setHeader("X-Request-Id", req.id); // optional
  next();
};

// and attach it to the response in error handling
message = `Something went wrong. Please provide this error ID: ${req.id} for support.`;
```

## Logs

Without logs, we are basically flying blind, and we really don’t want this.

Most of the times we can just use console.log to log the information we want.
However, for a more robust logger, I recommend using `winston` or `pino`.
Using a logger library has some benefits:

- Log levels, which we can customize based on environment.
- Structured logs such as JSON helps with filtering in production.
- Log transports: simply pipe to stdout or stderr, to files, or pipe onto Cloud services.
- Additional metadata such as timestamps.
- Pretty format for readability, useful for debugging in development.

[Here](https://betterstack.com/community/guides/logging/how-to-install-setup-and-use-winston-and-morgan-to-log-node-js-applications/)
is a good read on logging best practices implemented with winston.

## Closing thoughts

Although the explanations and examples are simple and limited in more
“real-world” use cases due to my experience at the time of writing, I hope
the tips I shared can help developers write more robust applications,
customize them freely to fit your needs, at least in error handling and
better logging.
