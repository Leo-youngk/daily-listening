/** 可复用的 Cache Storage 测试替身，保留 Response 的真实流/Blob 语义。 */
export function memoryCaches() {
  const stores = new Map<string, Map<string, Response>>()
  const keyOf = (key: RequestInfo | URL) => key instanceof Request ? key.url : String(key)
  return {
    stores,
    async open(name: string): Promise<Cache> {
      if (!stores.has(name)) stores.set(name, new Map())
      const items = stores.get(name)!
      return {
        async match(key: RequestInfo | URL) { return items.get(keyOf(key))?.clone() },
        async put(key: RequestInfo | URL, response: Response) { items.set(keyOf(key), response.clone()) },
        async delete(key: RequestInfo | URL) { return items.delete(keyOf(key)) },
        async keys() { return Array.from(items.keys(), key => new Request(key)) },
      } as unknown as Cache
    },
    async delete(name: string) { return stores.delete(name) },
    async keys() { return Array.from(stores.keys()) },
  }
}
