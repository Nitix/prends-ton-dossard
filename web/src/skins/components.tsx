import { createElement, type ComponentType } from "react";

import { useSkinVariant, useSlot } from ".";
import type { SlotName, SlotProps, VariantName, VariantProps } from "./types";

// The two ways the app draws what a skin changes, each made once, at the top of
// a module: the motif of a slot (`slotted`), and a component that a skin may
// replace at depth mix or full (`skinnable`). What they draw is a component of
// the registry, the same for as long as the skin is: never one made during the
// render (which is what `react/static-components` guards against).

/**
 * The component that draws the motif of the skin of the page in the slot
 * `name`: its own, or Crête's. components/Slots.tsx makes one per slot.
 */
export function slotted<N extends SlotName>(name: N): ComponentType<SlotProps[N]> {
  function Slotted(props: SlotProps[N]) {
    const Motif: ComponentType<SlotProps[N]> = useSlot(name);
    return createElement(Motif, props);
  }
  Slotted.displayName = `Slot(${name})`;
  return Slotted;
}

/**
 * A component that a skin may replace, by its name in `VariantProps`
 * (types.ts): `export const EventCard = skinnable("EventCard", EventCardBase)`.
 * It draws the variant that the skin of the page exports under that name from
 * its `mix.tsx` or `full.tsx` when the build is deep enough to have it, and
 * `Base` otherwise.
 */
export function skinnable<N extends VariantName>(
  name: N,
  Base: ComponentType<VariantProps[N]>,
): ComponentType<VariantProps[N]> {
  function Skinnable(props: VariantProps[N]) {
    const Component = useSkinVariant(name, Base);
    return createElement(Component, props);
  }
  Skinnable.displayName = `Skinnable(${name})`;
  return Skinnable;
}
