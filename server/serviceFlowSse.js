// Public service links use a small in-memory SSE fan-out. The event contains
// no service content; viewers always re-fetch the server-sanitized snapshot.
const serviceFlowSseClients = new Map();

export const addServiceFlowSseClient = (shareId, res) => {
  const clients = serviceFlowSseClients.get(shareId);
  if (clients) {
    clients.add(res);
    return;
  }
  serviceFlowSseClients.set(shareId, new Set([res]));
};

export const removeServiceFlowSseClient = (shareId, res) => {
  const clients = serviceFlowSseClients.get(shareId);
  if (!clients) return;
  clients.delete(res);
  if (clients.size === 0) serviceFlowSseClients.delete(shareId);
};

/** Call after a published service flow or its live-progress state changes. */
export const emitServiceFlowUpdated = (shareId, revision) => {
  const clients = serviceFlowSseClients.get(shareId);
  if (!clients?.size) return;
  const event = JSON.stringify({
    type: "service-updated",
    timestamp: Date.now(),
    ...(Number.isSafeInteger(revision) ? { revision } : {}),
  });
  clients.forEach((client) => {
    try {
      client.write(`data: ${event}\n\n`);
    } catch (error) {
      console.error("Could not write service flow SSE event:", error);
    }
  });
};
