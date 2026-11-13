import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Bell,
  History,
  Layers,
  Map as MapIcon,
  RefreshCw,
  ShieldAlert,
  Truck,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { AlertRulesPanel } from './components/AlertRulesPanel';
import { GeofencePanel } from './components/GeofencePanel';
import { LiveAlertFeed } from './components/LiveAlertFeed';
import { MapWorkspace, type MapFocusTarget, type MapMode } from './components/MapWorkspace';
import { ToastNotifications } from './components/ToastNotifications';
import { VehiclePanel } from './components/VehiclePanel';
import { ViolationHistoryPanel } from './components/ViolationHistoryPanel';
import { useAlertsWebSocket } from './hooks/useAlertsWebSocket';
import {
  fetchGeofences,
  fetchRecentAlertEvents,
  fetchVehicleLocation,
  fetchVehicles,
  updateVehicleLocation,
} from './services/api';
import type { Geofence, Vehicle, VehicleLocationStatus, WebSocketAlert } from './types/api';

type MainTab = 'operations' | 'alerts' | 'history';
type SideTab = 'geofences' | 'vehicles' | 'feed';

export function App() {
  const [mainTab, setMainTab] = useState<MainTab>('operations');
  const [sideTab, setSideTab] = useState<SideTab>('geofences');

  const [geofences, setGeofences] = useState<Geofence[]>([]);
  const [allGeofences, setAllGeofences] = useState<Geofence[]>([]);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [loadingGeofences, setLoadingGeofences] = useState(false);

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehicleLocations, setVehicleLocations] = useState<Record<string, VehicleLocationStatus>>({});
  const [selectedVehicleId, setSelectedVehicleId] = useState('');

  const [liveAlerts, setLiveAlerts] = useState<WebSocketAlert[]>([]);
  const [toasts, setToasts] = useState<WebSocketAlert[]>([]);
  const [historyRefreshSignal, setHistoryRefreshSignal] = useState(0);

  // Interactive Map state
  const [mapMode, setMapMode] = useState<MapMode>('inspect');
  const [draftPoints, setDraftPoints] = useState<[number, number][]>([]);
  const [pickedCoords, setPickedCoords] = useState<{ lat: number; lon: number; nonce: number } | null>(null);
  const [focusTarget, setFocusTarget] = useState<MapFocusTarget | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  const loadGeofences = useCallback(async () => {
    setLoadingGeofences(true);
    try {
      const [filteredRes, allRes] = await Promise.all([
        fetchGeofences(categoryFilter || undefined),
        categoryFilter ? fetchGeofences() : Promise.resolve(null),
      ]);
      setGeofences(filteredRes.geofences);
      setAllGeofences(allRes ? allRes.geofences : filteredRes.geofences);
      setSyncError(null);
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Unable to connect to backend API');
    } finally {
      setLoadingGeofences(false);
    }
  }, [categoryFilter]);

  const refreshVehicleLocation = useCallback(async (vehicleId: string) => {
    try {
      const loc = await fetchVehicleLocation(vehicleId);
      setVehicleLocations((prev) => ({ ...prev, [vehicleId]: loc }));
      setHistoryRefreshSignal((n) => n + 1);
    } catch {
      // Ignore individual vehicle location fetch failures
    }
  }, []);

  const loadVehicles = useCallback(async () => {
    try {
      const res = await fetchVehicles();
      setVehicles(res.vehicles);
      setSelectedVehicleId((prev) => prev || (res.vehicles[0]?.id ?? ''));
      const statuses = await Promise.all(
        res.vehicles.map((v) => fetchVehicleLocation(v.id).catch(() => null))
      );
      const map: Record<string, VehicleLocationStatus> = {};
      statuses.forEach((s) => {
        if (s) map[s.vehicle_id] = s;
      });
      setVehicleLocations(map);
      setSyncError(null);
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Unable to load vehicles');
    }
  }, []);

  useEffect(() => {
    void loadGeofences();
  }, [loadGeofences]);

  useEffect(() => {
    void loadVehicles();
    void fetchRecentAlertEvents(25)
      .then((res) => {
        if (Array.isArray(res.events)) {
          setLiveAlerts(res.events);
        }
      })
      .catch(() => {});
  }, [loadVehicles]);

  const handleIncomingAlert = useCallback((alert: WebSocketAlert) => {
    setLiveAlerts((prev) => {
      if (prev.some((a) => a.event_id === alert.event_id)) return prev;
      return [alert, ...prev].slice(0, 100);
    });
    setToasts((prev) => [alert, ...prev].slice(0, 4));
    setHistoryRefreshSignal((n) => n + 1);

    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.event_id !== alert.event_id));
    }, 8000);
  }, []);

  const { status: wsStatus } = useAlertsWebSocket(handleIncomingAlert);

  const dismissToast = useCallback((eventId: string) => {
    setToasts((prev) => prev.filter((t) => t.event_id !== eventId));
  }, []);

  const handleFocusLocation = useCallback((center: [number, number]) => {
    setFocusTarget({ center, zoom: 14, nonce: Date.now() });
  }, []);

  const handleAddDraftPoint = useCallback((pt: [number, number]) => {
    setDraftPoints((prev) => [...prev, pt]);
  }, []);

  const handleUndoDraftPoint = useCallback(() => {
    setDraftPoints((prev) => prev.slice(0, -1));
  }, []);

  const handleClearDraftPoints = useCallback(() => {
    setDraftPoints([]);
  }, []);

  const handleUseDraftPolygon = useCallback(() => {
    setMapMode('inspect');
    setSideTab('geofences');
  }, []);

  const handlePickLocation = useCallback(
    async (lat: number, lon: number) => {
      setPickedCoords({ lat, lon, nonce: Date.now() });
      setSideTab('vehicles');
      if (!selectedVehicleId) return;
      try {
        await updateVehicleLocation({
          vehicle_id: selectedVehicleId,
          latitude: lat,
          longitude: lon,
          timestamp: new Date().toISOString(),
        });
        await refreshVehicleLocation(selectedVehicleId);
      } catch {
        // Validation/network error will show via form if submitted manually
      }
    },
    [selectedVehicleId, refreshVehicleLocation]
  );

  const activeRestrictedCount = useMemo(
    () =>
      Object.values(vehicleLocations).filter((loc) =>
        loc.current_geofences.some((g) => g.category === 'restricted_zone')
      ).length,
    [vehicleLocations]
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <ToastNotifications toasts={toasts} onDismiss={dismissToast} />

      {/* Top Header */}
      <header className="sticky top-0 z-[1500] border-b border-slate-800 bg-slate-950/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-500/15 border border-sky-500/30">
              <Activity className="h-5 w-5 text-sky-400" />
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-tight text-white sm:text-base">
                MapUp Geofencing &amp; Alert System
              </h1>
              <p className="text-[11px] text-slate-400">
                Real-time PostGIS Spatial Tracking &amp; WebSocket Telemetry
              </p>
            </div>
          </div>

          {/* Navigation Tabs */}
          <nav className="flex items-center gap-1 rounded-xl border border-slate-800 bg-slate-900 p-1">
            <button
              type="button"
              onClick={() => setMainTab('operations')}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                mainTab === 'operations'
                  ? 'bg-sky-500 text-slate-950 font-semibold'
                  : 'text-slate-300 hover:bg-slate-800'
              }`}
            >
              <MapIcon className="h-3.5 w-3.5" />
              Live Operations
            </button>
            <button
              type="button"
              onClick={() => setMainTab('alerts')}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                mainTab === 'alerts'
                  ? 'bg-sky-500 text-slate-950 font-semibold'
                  : 'text-slate-300 hover:bg-slate-800'
              }`}
            >
              <Bell className="h-3.5 w-3.5" />
              Alert Rules
            </button>
            <button
              type="button"
              onClick={() => setMainTab('history')}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                mainTab === 'history'
                  ? 'bg-sky-500 text-slate-950 font-semibold'
                  : 'text-slate-300 hover:bg-slate-800'
              }`}
            >
              <History className="h-3.5 w-3.5" />
              Violation History
            </button>
          </nav>

          {/* Status & Metrics */}
          <div className="flex items-center gap-2.5">
            <div className="hidden xl:flex items-center gap-3 text-xs text-slate-400 mr-1">
              <span className="flex items-center gap-1">
                <Layers className="h-3.5 w-3.5 text-emerald-400" />
                <strong className="text-white">{allGeofences.length}</strong> Zones
              </span>
              <span className="flex items-center gap-1">
                <Truck className="h-3.5 w-3.5 text-sky-400" />
                <strong className="text-white">{vehicles.length}</strong> Vehicles
              </span>
              {activeRestrictedCount > 0 && (
                <span className="flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-red-300 border border-red-500/30">
                  <ShieldAlert className="h-3.5 w-3.5" />
                  <strong>{activeRestrictedCount}</strong> Restricted
                </span>
              )}
            </div>

            <div
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${
                wsStatus === 'connected'
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                  : wsStatus === 'connecting'
                  ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                  : 'border-red-500/30 bg-red-500/10 text-red-300'
              }`}
            >
              {wsStatus === 'connected' ? (
                <Wifi className="h-3.5 w-3.5" />
              ) : (
                <WifiOff className="h-3.5 w-3.5" />
              )}
              <span>WS: {wsStatus}</span>
            </div>

            <button
              type="button"
              onClick={() => {
                void loadGeofences();
                void loadVehicles();
              }}
              className="rounded-lg border border-slate-700 bg-slate-900 p-1.5 text-slate-300 hover:bg-slate-800 hover:text-white"
              title="Refresh data"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      {syncError && (
        <div className="mx-auto mt-3 w-full max-w-[1600px] px-4">
          <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2.5 text-xs text-red-300">
            API Connection Warning: {syncError}. Check that the Go backend is running and CORS/VITE_API_URL is configured.
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="mx-auto w-full max-w-[1600px] flex-1 p-4">
        {mainTab === 'operations' && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
            {/* Map Pane */}
            <div className="lg:col-span-7 xl:col-span-8 h-[540px] lg:h-[calc(100vh-120px)]">
              <MapWorkspace
                geofences={geofences}
                vehicles={vehicles}
                vehicleLocations={vehicleLocations}
                selectedVehicleId={selectedVehicleId}
                mapMode={mapMode}
                onMapModeChange={setMapMode}
                draftPoints={draftPoints}
                onAddDraftPoint={handleAddDraftPoint}
                onUndoDraftPoint={handleUndoDraftPoint}
                onClearDraftPoints={handleClearDraftPoints}
                onUseDraftPolygon={handleUseDraftPolygon}
                onPickLocation={(lat, lon) => void handlePickLocation(lat, lon)}
                focusTarget={focusTarget}
              />
            </div>

            {/* Control Sidebar */}
            <div className="lg:col-span-5 xl:col-span-4 flex flex-col rounded-2xl border border-slate-800 bg-slate-900/50 overflow-hidden lg:h-[calc(100vh-120px)]">
              <div className="grid grid-cols-3 border-b border-slate-800 bg-slate-900/90 p-1.5 gap-1">
                <button
                  type="button"
                  onClick={() => setSideTab('geofences')}
                  className={`rounded-lg py-2 text-xs font-semibold transition ${
                    sideTab === 'geofences'
                      ? 'bg-sky-500 text-slate-950'
                      : 'text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  Geofences ({geofences.length})
                </button>
                <button
                  type="button"
                  onClick={() => setSideTab('vehicles')}
                  className={`rounded-lg py-2 text-xs font-semibold transition ${
                    sideTab === 'vehicles'
                      ? 'bg-sky-500 text-slate-950'
                      : 'text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  Vehicles ({vehicles.length})
                </button>
                <button
                  type="button"
                  onClick={() => setSideTab('feed')}
                  className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition ${
                    sideTab === 'feed'
                      ? 'bg-sky-500 text-slate-950'
                      : 'text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  <span>Live Alerts</span>
                  {liveAlerts.length > 0 && (
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                        sideTab === 'feed'
                          ? 'bg-slate-950 text-sky-400'
                          : 'bg-red-500/20 text-red-300'
                      }`}
                    >
                      {liveAlerts.length}
                    </span>
                  )}
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                {sideTab === 'geofences' && (
                  <GeofencePanel
                    geofences={geofences}
                    loading={loadingGeofences}
                    categoryFilter={categoryFilter}
                    onCategoryFilterChange={setCategoryFilter}
                    draftPoints={draftPoints}
                    onStartDrawOnMap={() => setMapMode('draw_geofence')}
                    onClearDraft={handleClearDraftPoints}
                    onCreated={loadGeofences}
                    onFocusGeofence={handleFocusLocation}
                  />
                )}

                {sideTab === 'vehicles' && (
                  <VehiclePanel
                    vehicles={vehicles}
                    geofences={allGeofences}
                    vehicleLocations={vehicleLocations}
                    selectedVehicleId={selectedVehicleId}
                    onSelectVehicle={setSelectedVehicleId}
                    pickedCoords={pickedCoords}
                    onStartPickOnMap={() => setMapMode('pick_location')}
                    onVehicleCreated={loadVehicles}
                    onLocationUpdated={refreshVehicleLocation}
                    onFocusLocation={handleFocusLocation}
                  />
                )}

                {sideTab === 'feed' && (
                  <LiveAlertFeed
                    alerts={liveAlerts}
                    wsStatus={wsStatus}
                    onClear={() => setLiveAlerts([])}
                    onFocusLocation={handleFocusLocation}
                  />
                )}
              </div>
            </div>
          </div>
        )}

        {mainTab === 'alerts' && (
          <AlertRulesPanel
            geofences={allGeofences}
            vehicles={vehicles}
            onRulesChanged={() => {}}
          />
        )}

        {mainTab === 'history' && (
          <ViolationHistoryPanel
            geofences={allGeofences}
            vehicles={vehicles}
            refreshSignal={historyRefreshSignal}
          />
        )}
      </main>
    </div>
  );
}

export default App;
