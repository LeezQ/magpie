// Hide entry points, not routes, so these features can return without a fork.
const hidden = new Set(['playground', 'models', 'subscription', 'mySubscription'])
export const visibleNavigation = (item) => !hidden.has(item.key)
