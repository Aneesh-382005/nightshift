import '@fontsource-variable/inter'
import '@fontsource/space-grotesk/600.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/caveat/700.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { SpacetimeDBProvider } from 'spacetimedb/react'
import { DbConnection, tables } from './module_bindings'
import App from './App'
import './index.css'

// Never localhost on a phone: default to the host the page was loaded from.
const URI = import.meta.env.VITE_STDB_URI ?? `ws://${window.location.hostname}:3000`
const DB = import.meta.env.VITE_STDB_DB ?? 'nightshift'
const TOKEN_KEY = 'nightshift_ui_token'

function savedToken(): string | undefined {
  try { return localStorage.getItem(TOKEN_KEY) ?? undefined } catch { return undefined }
}

// Module scope, so StrictMode does not open two connections.
// This identity is a plain viewer: the module only lets it call submitRequest.
const connectionBuilder = DbConnection.builder()
  .withUri(URI)
  .withDatabaseName(DB)
  .withToken(savedToken())
  .onConnect((conn, _identity, token) => {
    try { localStorage.setItem(TOKEN_KEY, token) } catch { /* private mode */ }
    conn.subscriptionBuilder().subscribe([
      tables.device, tables.accessGrant, tables.event, tables.change,
      tables.incident, tables.runbookTrust, tables.runResult, tables.userRequest,
    ])
  })
  .onConnectError((_ctx, err) => console.error('connect error', err))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SpacetimeDBProvider connectionBuilder={connectionBuilder}>
      <App uri={URI} />
    </SpacetimeDBProvider>
  </StrictMode>,
)
