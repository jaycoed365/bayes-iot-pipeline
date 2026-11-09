import Dashboard from "./dashboard";

// The dashboard component renders its own header, status bar and footer,
// so the page just mounts it (avoids the doubled header/footer).
export default function Home() {
  return <Dashboard />;
}
