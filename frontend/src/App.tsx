import { useEffect, useState } from "react";
import "./App.css";

const API_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8080";

function App() {
  const [apiStatus, setApiStatus] = useState("Checking...");
  const [databaseStatus, setDatabaseStatus] = useState("Checking...");

  useEffect(() => {
    let active = true;

    async function checkEndpoint(path: string) {
      const response = await fetch(`${API_URL}${path}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Request failed");
      }

      return `${data.status} — ${data.time_ns} ns`;
    }

    async function checkServices() {
      const [api, database] = await Promise.all([
        checkEndpoint("/health").catch(
          (error) => `Unavailable: ${error.message}`,
        ),
        checkEndpoint("/health/db").catch(
          (error) => `Unavailable: ${error.message}`,
        ),
      ]);

      if (active) {
        setApiStatus(api);
        setDatabaseStatus(database);
      }
    }

    checkServices();

    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="dashboard">
      <h1>MapUp Geofencing System</h1>
      <p>Project initialization dashboard</p>

      <section className="status-card">
        <h2>Backend API</h2>
        <p>{apiStatus}</p>
      </section>

      <section className="status-card">
        <h2>PostgreSQL + PostGIS</h2>
        <p>{databaseStatus}</p>
      </section>
    </main>
  );
}

export default App;
