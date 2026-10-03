import { Component, type ReactNode } from "react";

// Renders `fallback` (nothing by default) if a child throws, e.g. a failed Convex
// query, so one broken section doesn't blank the whole page.
export default class HideOnError extends Component<{ children: ReactNode; fallback?: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (this.props.fallback ?? null) : this.props.children;
  }
}
