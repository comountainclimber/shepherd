import { Component, type ReactNode } from "react";
import { Shell } from "./components/shell/Shell";

class AppError extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error) };
  }

  render() {
    if (this.state.error) {
      return <pre data-app-error="true" className="whitespace-pre-wrap p-4 text-[12px] text-failed">{this.state.error}</pre>;
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <AppError>
      <Shell />
    </AppError>
  );
}
