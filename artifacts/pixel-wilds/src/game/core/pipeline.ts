/**
 * An ordered pipeline of stages.
 *
 * Chunk generation used to be a fixed sequence of calls inside `world.ts`, so
 * every new pass (ores, flowers, structures, carvings) meant editing the world
 * module and wiring a new import into it. A pipeline makes the sequence data:
 * a stage registers itself with an order, and the generator only knows that a
 * pipeline exists. Enabling or disabling a pass is a registration decision,
 * not a code edit scattered through the world builder.
 */

export interface Stage<TContext> {
  readonly id: string;
  /** Lower runs first. Equal orders keep registration order. */
  readonly order: number;
  /** A disabled stage stays registered (and documented) but does not run. */
  readonly enabled?: boolean;
  run(context: TContext): void;
}

export class Pipeline<TContext> {
  private readonly stages: Stage<TContext>[] = [];

  constructor(readonly label: string) {}

  register(stage: Stage<TContext>): this {
    if (!stage.id) throw new Error(`${this.label} pipeline: stages need an id`);
    if (this.stages.some((existing) => existing.id === stage.id)) {
      throw new Error(`${this.label} pipeline: duplicate stage "${stage.id}"`);
    }
    if (!Number.isFinite(stage.order)) {
      throw new Error(`${this.label} pipeline: stage "${stage.id}" needs a finite order`);
    }
    this.stages.push(stage);
    // Stable sort: equal orders keep registration order.
    this.stages.sort((a, b) => a.order - b.order);
    return this;
  }

  remove(id: string): boolean {
    const index = this.stages.findIndex((stage) => stage.id === id);
    if (index < 0) return false;
    this.stages.splice(index, 1);
    return true;
  }

  list(): readonly Stage<TContext>[] {
    return [...this.stages];
  }

  /**
   * Runs every enabled stage in order and returns the ids that ran, which
   * makes the execution order observable to tests without monkey-patching.
   */
  run(context: TContext): string[] {
    const ran: string[] = [];
    for (const stage of this.stages) {
      if (stage.enabled === false) continue;
      stage.run(context);
      ran.push(stage.id);
    }
    return ran;
  }
}
