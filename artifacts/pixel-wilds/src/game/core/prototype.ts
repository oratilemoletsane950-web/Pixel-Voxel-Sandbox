/**
 * Prototype pattern.
 *
 * A prototype is a frozen, fully configured object that new variants are
 * cloned from with `.extend(overrides)`, rather than re-declaring every field
 * or subclassing. Families of blocks, vegetation species and generation stages
 * are expressed this way: define the shared shape once, derive variants from
 * it, and never mutate a live object.
 *
 * The original prototype is never touched, so an entry can be added without
 * risking a sibling's behaviour.
 */

export type Prototype<T extends object> = Readonly<T> & {
  /** Id of the prototype this object was cloned from, for introspection. */
  readonly prototypeOf: string;
  /** Clone with overrides; the receiver is left unchanged. */
  extend<U extends object>(overrides: U): Prototype<T & U>;
};

export function prototype<T extends object>(base: T, prototypeOf = "base"): Prototype<T> {
  const extend = <U extends object>(overrides: U): Prototype<T & U> =>
    prototype({ ...base, ...overrides } as T & U, prototypeOf);
  return Object.freeze({ ...base, prototypeOf, extend }) as Prototype<T>;
}
