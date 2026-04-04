import React, { type FC, useState, useEffect, useCallback } from 'react';
import { dashboard } from '@wix/dashboard';
import { auth } from '@wix/essentials';
// auth.getTokenInfo() returns TokenInfo including instanceId (app instance ID)
import {
  Badge,
  Box,
  Button,
  Card,
  Dropdown,
  Loader,
  Page,
  Table,
  TableToolbar,
  Text,
  WixDesignSystemProvider,
} from '@wix/design-system';
import '@wix/design-system/styles.global.css';
import {
  Add,
  Delete,
  Refresh,
  StatusComplete,
  StatusAlert,
  DataDisconnect,
  ExternalLink,
} from '@wix/wix-ui-icons-common';

const BASE_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';

const DIRECTION_OPTIONS: Array<{ id: string; value: string }> = [
  { id: 'WIX_TO_HS', value: 'Wix → HubSpot' },
  { id: 'HS_TO_WIX', value: 'HubSpot → Wix' },
  { id: 'BOTH', value: 'Bi-directional' },
];

type Direction = 'WIX_TO_HS' | 'HS_TO_WIX' | 'BOTH';

interface MappingRow {
  id: string;
  wixField: string;
  hubspotProperty: string;
  direction: Direction;
}

interface ConnectionStatus {
  connected: boolean;
  portalName?: string;
}

interface MappingsResponse {
  mappings: Array<{ wixField: string; hubspotProperty: string; direction: Direction }>;
  wixFields: Array<{ key: string; label: string }>;
  hubspotProperties: Array<{ name: string; label: string; type: string }>;
}

function generateId(): string {
  return Math.random().toString(36).slice(2);
}

const HubSpotDashboard: FC = () => {
  const [instanceId, setInstanceId] = useState<string>('');
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus | null>(null);
  const [connectionLoading, setConnectionLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);

  const [mappingRows, setMappingRows] = useState<MappingRow[]>([]);
  const [wixFields, setWixFields] = useState<Array<{ key: string; label: string }>>([]);
  const [hubspotProperties, setHubspotProperties] = useState<Array<{ name: string; label: string; type: string }>>([]);
  const [mappingsLoading, setMappingsLoading] = useState(false);
  const [savingMappings, setSavingMappings] = useState(false);

  const [syncing, setSyncing] = useState(false);

  // Fetch connection status
  const fetchConnectionStatus = useCallback(async (id: string) => {
    setConnectionLoading(true);
    try {
      const res = await fetch(`${BASE_URL}/api/oauth/status/${id}`);
      if (!res.ok) throw new Error('Failed to fetch status');
      const data: ConnectionStatus = await res.json();
      setConnectionStatus(data);
    } catch {
      dashboard.showToast({
        message: 'Failed to load HubSpot connection status.',
        type: 'error',
      });
      setConnectionStatus({ connected: false });
    } finally {
      setConnectionLoading(false);
    }
  }, []);

  // Fetch mappings when connected
  const fetchMappings = useCallback(async (id: string) => {
    setMappingsLoading(true);
    try {
      const res = await fetch(`${BASE_URL}/api/mappings/${id}`);
      if (!res.ok) throw new Error('Failed to fetch mappings');
      const data: MappingsResponse = await res.json();
      setWixFields(data.wixFields ?? []);
      setHubspotProperties(data.hubspotProperties ?? []);
      setMappingRows(
        (data.mappings ?? []).map((m) => ({
          id: generateId(),
          wixField: m.wixField,
          hubspotProperty: m.hubspotProperty,
          direction: m.direction,
        }))
      );
    } catch {
      dashboard.showToast({
        message: 'Failed to load field mappings.',
        type: 'error',
      });
    } finally {
      setMappingsLoading(false);
    }
  }, []);

  // Load instanceId on mount
  useEffect(() => {
    const init = async () => {
      try {
        // Try @wix/essentials first
        let id = '';
        try {
          const tokenInfo = await auth.getTokenInfo();
          id = tokenInfo.instanceId ?? '';
        } catch {
          // ignore
        }

        // Fallback: parse the Wix instance JWT from the URL
        if (!id) {
          const params = new URLSearchParams(window.location.search);
          const instanceJwt = params.get('instance');
          if (instanceJwt) {
            try {
              const payload = JSON.parse(atob(instanceJwt.split('.')[1]));
              id = payload.instanceId ?? '';
            } catch {
              // ignore
            }
          }
        }

        console.log('[HubSpot] instanceId:', id);
        setInstanceId(id);
        if (id) {
          await fetchConnectionStatus(id);
        } else {
          console.warn('[HubSpot] Could not resolve instanceId');
          setConnectionLoading(false);
          setConnectionStatus({ connected: false });
        }
      } catch (err) {
        console.error('[HubSpot] Failed to get instanceId:', err);
        setConnectionLoading(false);
        setConnectionStatus({ connected: false });
      }
    };
    init();
  }, [fetchConnectionStatus]);

  // Fetch mappings whenever connection becomes active
  useEffect(() => {
    if (connectionStatus?.connected && instanceId) {
      fetchMappings(instanceId);
    }
  }, [connectionStatus?.connected, instanceId, fetchMappings]);

  // Auto-refresh status when user returns to this tab — only if currently disconnected
  // (user likely went to complete OAuth in a new tab)
  useEffect(() => {
    if (!instanceId) return;
    const handleFocus = () => {
      if (!connectionStatus?.connected) {
        fetchConnectionStatus(instanceId);
      }
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [instanceId, connectionStatus?.connected, fetchConnectionStatus]);

  const handleConnect = () => {
    const url = `${BASE_URL}/oauth/hubspot/init?instanceId=${instanceId}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      const res = await fetch(
        `${BASE_URL}/api/oauth/status/${instanceId}`,
        { method: 'DELETE' }
      );
      if (!res.ok) throw new Error('Disconnect failed');
      setConnectionStatus({ connected: false });
      setMappingRows([]);
      dashboard.showToast({ message: 'HubSpot disconnected successfully.', type: 'success' });
    } catch {
      dashboard.showToast({ message: 'Failed to disconnect HubSpot.', type: 'error' });
    } finally {
      setDisconnecting(false);
    }
  };

  const handleAddRow = () => {
    setMappingRows((prev) => [
      ...prev,
      { id: generateId(), wixField: '', hubspotProperty: '', direction: 'WIX_TO_HS' },
    ]);
  };

  const handleDeleteRow = (id: string) => {
    setMappingRows((prev) => prev.filter((r) => r.id !== id));
  };

  const handleRowChange = (id: string, field: keyof Omit<MappingRow, 'id'>, value: string) => {
    setMappingRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, [field]: value } : r))
    );
  };

  const handleSaveMappings = async () => {
    setSavingMappings(true);
    try {
      const res = await fetch(`${BASE_URL}/api/mappings/${instanceId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mappings: mappingRows.map(({ wixField, hubspotProperty, direction }) => ({
            wixField,
            hubspotProperty,
            direction,
          })),
        }),
      });
      if (!res.ok) throw new Error('Save failed');
      dashboard.showToast({ message: 'Mappings saved successfully.', type: 'success' });
    } catch {
      dashboard.showToast({ message: 'Failed to save mappings.', type: 'error' });
    } finally {
      setSavingMappings(false);
    }
  };

  const handleManualSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch(`${BASE_URL}/api/sync/${instanceId}`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error('Sync failed');
      dashboard.showToast({ message: 'Manual sync completed successfully.', type: 'success' });
    } catch {
      dashboard.showToast({ message: 'Manual sync failed. Please try again.', type: 'error' });
    } finally {
      setSyncing(false);
    }
  };

  const wixFieldOptions = wixFields.map((f) => ({ id: f.key, value: f.label }));
  const hubspotPropOptions = hubspotProperties.map((p) => ({ id: p.name, value: `${p.label} (${p.name})` }));

  const tableColumns = [
    {
      title: 'Wix Field',
      render: (row: MappingRow) => (
        <Dropdown
          placeholder="Select Wix field"
          options={wixFieldOptions}
          selectedId={row.wixField || undefined}
          onSelect={(option) => handleRowChange(row.id, 'wixField', String(option.id))}
          size="small"
        />
      ),
    },
    {
      title: 'HubSpot Property',
      render: (row: MappingRow) => (
        <Dropdown
          placeholder="Select HubSpot property"
          options={hubspotPropOptions}
          selectedId={row.hubspotProperty || undefined}
          onSelect={(option) => handleRowChange(row.id, 'hubspotProperty', String(option.id))}
          size="small"
        />
      ),
    },
    {
      title: 'Sync Direction',
      render: (row: MappingRow) => (
        <Dropdown
          options={DIRECTION_OPTIONS}
          selectedId={row.direction}
          onSelect={(option) => handleRowChange(row.id, 'direction', String(option.id) as Direction)}
          size="small"
        />
      ),
    },
    {
      title: '',
      render: (row: MappingRow) => (
        <Button
          skin="destructive"
          priority="secondary"
          size="small"
          prefixIcon={<Delete />}
          onClick={() => handleDeleteRow(row.id)}
        >
          Remove
        </Button>
      ),
    },
  ];

  return (
    <WixDesignSystemProvider features={{ newColorsBranding: true }}>
      <Page>
        <Page.Header
          title="HubSpot Integration"
          subtitle="Manage your HubSpot connection, field mappings, and data sync."
        />
        <Page.Content>
          <Box direction="vertical" gap="SP4">
            {/* Connection Card */}
            <Card>
              <Card.Header
                title="HubSpot Connection"
                suffix={
                  connectionLoading ? (
                    <Loader size="tiny" />
                  ) : connectionStatus?.connected ? (
                    <Badge skin="success" prefixIcon={<StatusComplete />}>
                      Connected
                    </Badge>
                  ) : (
                    <Badge skin="danger" prefixIcon={<StatusAlert />}>
                      Disconnected
                    </Badge>
                  )
                }
              />
              <Card.Divider />
              <Card.Content>
                {connectionLoading ? (
                  <Box align="center" padding="SP6">
                    <Loader size="medium" text="Checking connection status..." />
                  </Box>
                ) : connectionStatus?.connected ? (
                  <Box direction="vertical" gap="SP3">
                    <Text>
                      Connected to HubSpot portal:{' '}
                      <Text weight="bold" tagName="span">
                        {connectionStatus.portalName ?? 'Unknown Portal'}
                      </Text>
                    </Text>
                    <Box gap="SP2">
                      <Button
                        skin="destructive"
                        priority="secondary"
                        prefixIcon={<DataDisconnect />}
                        onClick={handleDisconnect}
                        disabled={disconnecting}
                      >
                        {disconnecting ? 'Disconnecting...' : 'Disconnect'}
                      </Button>
                      <Button
                        priority="secondary"
                        prefixIcon={<Refresh />}
                        onClick={() => fetchConnectionStatus(instanceId)}
                      >
                        Refresh Status
                      </Button>
                    </Box>
                  </Box>
                ) : (
                  <Box direction="vertical" gap="SP3">
                    <Text secondary>
                      Connect your HubSpot account to enable contact syncing and field mappings.
                    </Text>
                    <Box>
                      <Button prefixIcon={<ExternalLink />} onClick={handleConnect}>
                        Connect HubSpot
                      </Button>
                    </Box>
                  </Box>
                )}
              </Card.Content>
            </Card>

            {/* Field Mappings Card — shown only when connected */}
            {connectionStatus?.connected && (
              <Card>
                <Table
                  data={mappingRows}
                  columns={tableColumns}
                >
                  <TableToolbar>
                    <TableToolbar.ItemGroup position="start">
                      <TableToolbar.Title>Field Mappings</TableToolbar.Title>
                    </TableToolbar.ItemGroup>
                    <TableToolbar.ItemGroup position="end">
                      <TableToolbar.Item>
                        <Button
                          priority="secondary"
                          prefixIcon={<Add />}
                          onClick={handleAddRow}
                          size="small"
                        >
                          Add Row
                        </Button>
                      </TableToolbar.Item>
                      <TableToolbar.Item>
                        <Button
                          onClick={handleSaveMappings}
                          disabled={savingMappings}
                          size="small"
                        >
                          {savingMappings ? 'Saving...' : 'Save Mappings'}
                        </Button>
                      </TableToolbar.Item>
                    </TableToolbar.ItemGroup>
                  </TableToolbar>
                  {mappingsLoading ? (
                    <Box align="center" padding="SP6">
                      <Loader size="medium" text="Loading field mappings..." />
                    </Box>
                  ) : (
                    <Table.Content />
                  )}
                </Table>
              </Card>
            )}

            {/* Manual Sync Card — shown only when connected */}
            {connectionStatus?.connected && (
              <Card>
                <Card.Header title="Manual Sync" />
                <Card.Divider />
                <Card.Content>
                  <Box direction="vertical" gap="SP3">
                    <Text secondary>
                      Trigger a one-time bulk sync between Wix and HubSpot based on your current
                      field mappings.
                    </Text>
                    <Box>
                      <Button
                        prefixIcon={<Refresh />}
                        onClick={handleManualSync}
                        disabled={syncing}
                      >
                        {syncing ? 'Syncing...' : 'Run Manual Sync'}
                      </Button>
                    </Box>
                  </Box>
                </Card.Content>
              </Card>
            )}
          </Box>
        </Page.Content>
      </Page>
    </WixDesignSystemProvider>
  );
};

export default HubSpotDashboard;
