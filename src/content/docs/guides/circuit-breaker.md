---
title: Circuit breakers
description: "Guarding a flaky upstream with a provider — and why resilience policy is not in core."
---

An upstream service starts timing out. Every request to your API now waits the full timeout before
failing, your connection pool fills with calls that were never going to succeed, and a dependency
that is merely slow takes your service down with it.

A circuit breaker stops that: after enough failures it stops calling, fails fast for a while, then
lets one request through to see whether the upstream recovered.

## Why this is a recipe and not a feature

green-tea will not ship a `@CircuitBreaker` decorator, and the reason is the same one that keeps the
dependency count at one: **resilience policy is application policy.** How many failures count as
broken, how long to stay open, whether a 500 is a failure but a 404 is not — those answers differ per
upstream, and a framework that picks them for you has either guessed or grown a configuration surface
larger than the feature.

What the framework owes you is somewhere to put it that doesn't turn into the mutable-bag problem.
That place is the graph, and it needs no new API.

## Where it goes: a provider, not a step

The instinct is to reach for a `@Step`, because a breaker feels like something that happens *during* a
request. It isn't.

A breaker's whole value is **memory across requests** — the failures it counted a second ago are why
it refuses to call now. A `@Step` is request-scoped and runs again from scratch on every request, so a
breaker built there would forget everything it learned and never open. A `@Provider` is app-scoped and
built once, which is exactly the lifetime a breaker's state needs.

So: one provider holds the raw client, another wraps it. The wrapper is what your handlers ask for.

```typescript
import { Provider, HttpError } from '@green-tea/core';

type BreakerState = 'closed' | 'open' | 'half-open';

class CircuitBreaker {
  #state: BreakerState = 'closed';
  #failures = 0;
  #openedAt = 0;

  constructor(
    private readonly threshold: number,
    private readonly resetMs: number,
    private readonly now: () => number = Date.now,   // injected so tests need no fake timers
  ) {}

  get state(): BreakerState {
    return this.#state;
  }

  async call<T>(operation: () => Promise<T>): Promise<T> {
    if (this.#state === 'open') {
      if (this.now() - this.#openedAt < this.resetMs) {
        throw new HttpError(503, 'billing is unavailable');   // fail fast, do not call
      }
      this.#state = 'half-open';                              // window elapsed: allow one trial
    }

    try {
      const result = await operation();
      this.#state = 'closed';                                 // a success closes it, from any state
      this.#failures = 0;
      return result;
    } catch (error) {
      this.#failures++;
      // A failed trial in half-open re-opens immediately: it just proved the upstream is still down,
      // and making it earn the full threshold again would hammer a service that is trying to recover.
      if (this.#state === 'half-open' || this.#failures >= this.threshold) {
        this.#state = 'open';
        this.#openedAt = this.now();
      }
      throw error;
    }
  }
}
```

Now wrap the client. The breaker instance lives on the provider, so it is created once with the app:

```typescript
@Provider({ provides: 'billingApi' })
class BillingApi {
  #client = new BillingClient(process.env.BILLING_URL!);

  provide() {
    return { billingApi: this.#client };
  }

  async dispose() {                       // released on app.close() — see dependency injection
    await this.#client.close();
  }
}

@Provider({ provides: 'billing', needs: ['billingApi'] })
class GuardedBilling {
  #breaker = new CircuitBreaker(3, 30_000);   // 3 failures, stay open 30s

  provide({ billingApi }: { billingApi: BillingApi }) {
    return {
      billing: {
        charge: (userId: string) => this.#breaker.call(() => billingApi.charge(userId)),
      },
    };
  }
}
```

A handler asks for the guarded one and never knows the difference:

```typescript
@Route('/orders')
class Orders {
  @Post('/')
  async create(@body() order: Order, @needs('billing') billing: GuardedBillingApi) {
    await billing.charge(order.userId);     // fails fast while the breaker is open
    return { ok: true };
  }
}
```

## What the graph does for you here

Nothing in the code above wires an order. Because `billing` declares `needs: ['billingApi']`:

- **The raw client is built before the wrapper**, always, without you sequencing anything.
- **Nothing can reach around the breaker** by accident — a handler asks for `billing`, and the only
  thing that holds `billingApi` is the wrapper.
- **`app.explain('/orders')` shows both**, so the guard is visible in the request's chain rather than
  buried in a decorator someone has to know about.
- **Routes that never charge anyone never build either one.** A route runs only its slice of the graph.

Swapping the breaker out for a different policy, or removing it, is one provider — the handlers do not
change, because they were never coupled to it.

## Testing it

The `now` parameter exists for this. No fake timers, no waiting 30 seconds:

```typescript
let clock = 0;
const breaker = new CircuitBreaker(2, 1000, () => clock);

await expect(call()).rejects.toThrow('down');
await expect(call()).rejects.toThrow('down');
expect(breaker.state).toBe('open');

clock = 2000;                    // window elapsed
await expect(call()).resolves.toBe('ok');
expect(breaker.state).toBe('closed');
```

For the provider wiring, override the upstream at the app level rather than mocking modules — see
[testing](/docs/guides/testing/).

## What this recipe does not do

Named, because a breaker that quietly does less than you assumed is worse than none:

- **Half-open lets every waiting request through, not one.** Under load, the moment the window
  elapses, all in-flight callers trial at once. If that matters, gate the trial with a flag the first
  caller claims.
- **State is per process.** Ten instances each keep their own count, so an upstream that is down for
  everyone is discovered ten times. Sharing it needs an external store, which is a different design.
- **A failure is any thrown error.** A 404 from the upstream counts the same as a timeout, and it
  usually should not. Filter inside `call` on whatever your client throws.
- **There is no timeout here.** A breaker counts failures; it does not create them. If the upstream
  hangs rather than erroring, pair this with an `AbortSignal` on the client.
- **No bulkhead, no retry, no jitter.** Deliberately — each is its own policy, and stacking them
  silently is how a retry storm gets built.

## Releasing the client

The raw-client provider above declares `dispose()`, which `app.close()` awaits during shutdown. That
is the same mechanism plugins use with `onShutdown` — see
[dependency injection](/docs/guides/dependency-injection/#releasing-what-a-provider-opened). A breaker
holds no resources of its own, so only the client needs one.
