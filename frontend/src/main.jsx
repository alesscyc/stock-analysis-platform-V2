import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";

class ErrorBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    if (this.state.error)
      return (
        <main className="fatal">
          <h1>Workspace could not render / 工作區無法顯示</h1>
          <p>Your saved account has not been reset. / 已儲存帳戶未被重設。</p>
          <pre>{this.state.error.message}</pre>
          <button className="button" onClick={() => location.reload()}>
            Reload / 重新載入
          </button>
        </main>
      );
    return this.props.children;
  }
}
createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
