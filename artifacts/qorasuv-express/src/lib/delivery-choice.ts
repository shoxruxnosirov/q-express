// How the checkout's delivery choice follows the shop's status as it refreshes.
// Kept apart from the component so the rules are tested on their own.

export type DeliveryChoice = { mode: 'now' | 'later'; slot: string };
export type SlotStatus = { open_now: boolean; slots: readonly string[]; earliest_accepted_at: string };

// Why the page changed the customer's choice for them, so it can say so.
// "closed": they had "Hozir" and the shop closed while checkout was open.
// "expired": the time they picked can no longer be taken.
export type ChoiceChange = { reason: 'closed' } | { reason: 'expired'; from: string };

// The server still takes a chosen slot until earliest_accepted_at, even after
// the refreshed list, which only offers slots half an hour ahead, has dropped
// it. So a choice is kept for exactly as long as it would be accepted.
export function stillAccepted(status: SlotStatus, slot: string) {
  return Boolean(slot) && new Date(slot).getTime() >= new Date(status.earliest_accepted_at).getTime();
}

// The slots the time select offers: the list, plus the current choice when it
// has dropped off the list but is still accepted.
export function offeredSlots(status: SlotStatus, value: DeliveryChoice) {
  const kept = value.mode === 'later' && stillAccepted(status, value.slot) && !status.slots.includes(value.slot);
  return kept ? [value.slot, ...status.slots] : [...status.slots];
}

// What the choice must become after a status refresh, and why, whenever the
// page changes it on the customer's behalf. Neither change is ever silent:
// an order meant for now must not quietly become one for tomorrow morning.
// `wasOpen` is the previous status: a shop that was already closed when the
// page opened only moves the default, which is nobody's choice to announce.
export function reconcileChoice(
  status: SlotStatus,
  value: DeliveryChoice,
  wasOpen = false,
): { next: DeliveryChoice; change?: ChoiceChange } {
  const first = status.slots[0] ?? '';
  if (!status.open_now && value.mode === 'now') {
    const slot = stillAccepted(status, value.slot) ? value.slot : first;
    return { next: { mode: 'later', slot }, change: slot && wasOpen ? { reason: 'closed' } : undefined };
  }
  if (value.mode === 'later' && !stillAccepted(status, value.slot)) {
    return {
      next: { mode: 'later', slot: first },
      change: value.slot && first ? { reason: 'expired', from: value.slot } : undefined,
    };
  }
  return { next: value };
}
