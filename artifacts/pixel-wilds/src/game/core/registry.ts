/**
 * A tiny, dependency-free registry.
 *
 * Every pluggable part of the game (blocks, vegetation species, generation
 * stages, biomes) used to be a hard-coded switch or a hand-maintained list.
 * Adding an entry meant editing several places, and forgetting one failed at
 * runtime instead of at startup. A Registry centralises that: entries are
 * registered by id, duplicates are rejected loudly, and iteration order is
 * explicit.
 */

export interface Identified {
  readonly id: string;
}

export class Registry<T extends Identified> {
  private readonly entries = new Map<string, T>();
  private readonly order: string[] = [];

  constructor(readonly label: string) {}

  register(entry: T): T {
    if (!entry.id) {
      throw new Error(`${this.label} registry: entries need a non-empty id`);
    }
    if (this.entries.has(entry.id)) {
      throw new Error(`${this.label} registry: duplicate id "${entry.id}"`);
    }
    this.entries.set(entry.id, entry);
    this.order.push(entry.id);
    return entry;
  }

  registerAll(entries: readonly T[]): this {
    for (const entry of entries) this.register(entry);
    return this;
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  get(id: string): T | undefined {
    return this.entries.get(id);
  }

  require(id: string): T {
    const found = this.entries.get(id);
    if (!found) {
      throw new Error(
        `${this.label} registry: unknown id "${id}". Known ids: ${this.order.join(", ")}`,
      );
    }
    return found;
  }

  /** Entries in registration order. */
  list(): readonly T[] {
    return this.order.map((id) => this.entries.get(id) as T);
  }

  ids(): readonly string[] {
    return [...this.order];
  }

  get size(): number {
    return this.order.length;
  }

  /**
   * Asserts the registry holds exactly `expectedIds`, in that order. Used where
   * ids are persisted or index-based (block ids in saved chunks), so a
   * reordered or missing entry fails at startup rather than corrupting saves.
   */
  assertExact(expectedIds: readonly string[]): void {
    const missing = expectedIds.filter((id) => !this.has(id));
    if (missing.length > 0) {
      throw new Error(`${this.label} registry: missing entries ${missing.join(", ")}`);
    }
    const unknown = this.ids().filter((id) => !expectedIds.includes(id));
    if (unknown.length > 0) {
      throw new Error(`${this.label} registry: entries without a declared slot ${unknown.join(", ")}`);
    }
    if (this.order.length !== expectedIds.length || this.order.some((id, index) => id !== expectedIds[index])) {
      throw new Error(
        `${this.label} registry: order must match the declared order (ids are index-based).`,
      );
    }
  }
}
