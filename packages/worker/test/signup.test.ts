describe("signup: tenant-registry backfill (idempotent)", () => {
  it("registers every KV-allowlist tenant exactly once, and re-running is a no-op", async () => {
    const { env, rows } = sqliteEnv(["casey", "sam"]);

    expect((await backfillTenantRegistry(env, NOW)).registered).toBe(2);
    expect((await backfillTenantRegistry(env, NOW)).registered).toBe(2); // idempotent

    const ids = rows<{ id: string; via_code: string | null }>("tenants");
    expect(ids.map((r) => r.id).sort()).toEqual(["casey", "sam"]);
    expect(ids.every((r) => r.via_code === null)).toBe(true); // operator-onboarded → no code
  });

  it("after convergence, a later call short-circuits without listing the allowlist", async () => {
    // The first run seeds the registry and stamps the `registry:backfilled` marker; every
    // subsequent run must return { registered: 0 } WITHOUT calling kv.list() — that list is
    // what burns the free-tier KV daily list-operation budget on each 5-minute cron tick.
    const { env } = sqliteEnv(["casey", "sam"]);

    expect((await backfillTenantRegistry(env, NOW)).registered).toBe(2);

    let listed = false;
    const realList = env.TENANT_KV.list.bind(env.TENANT_KV);
    const spy = env.TENANT_KV as KVNamespace & { list: KVNamespace["list"] };
    spy.list = async (...args: Parameters<KVNamespace["list"]>) => {
      listed = true;
      return realList(...args);
    };

    expect((await backfillTenantRegistry(env, NOW)).registered).toBe(0);
    expect(listed).toBe(false); // no kv.list() after the marker is set
  });
});
