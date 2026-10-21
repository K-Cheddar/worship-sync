// Server-Sent Events fan-out for the Teams page. Teams data lives in the
// SQL/REST backend (not CouchDB), so there is no live replication channel like
// the Controller has. This module lets the schedule mutation handlers push a
// change notification to every other client viewing the same church, giving
// the scheduling grid real-time collaboration without touching the trusted
// REST write path. Schedule documents are Teams data; Services events are
// identifiers only because this channel is not permissioned for Services.
//
// The client registry is in-memory, which is sufficient for the current
// single-instance deployment. If the server is ever load-balanced across
// multiple instances, events emitted on one instance won't reach SSE clients
// connected to another — that would need a shared pub/sub (e.g. Redis).

const teamsSseClients = new Map();
const churchServiceTimeZoneSseClients = new Map();

const addClient = (clientsByChurch, churchId, res) => {
  if (!churchId || !res) return;
  const clients = clientsByChurch.get(churchId);
  if (clients) {
    clients.add(res);
    return;
  }
  clientsByChurch.set(churchId, new Set([res]));
};

const removeClient = (clientsByChurch, churchId, res) => {
  const clients = clientsByChurch.get(churchId);
  if (!clients) return;
  clients.delete(res);
  if (clients.size === 0) clientsByChurch.delete(churchId);
};

export const addTeamsSseClient = (churchId, res) => {
  if (!churchId) return;
  const clients = teamsSseClients.get(churchId);
  if (clients) {
    clients.add(res);
    return;
  }
  teamsSseClients.set(churchId, new Set([res]));
};

export const removeTeamsSseClient = (churchId, res) => {
  removeClient(teamsSseClients, churchId, res);
};

export const addChurchServiceTimeZoneSseClient = (churchId, res) => {
  addClient(churchServiceTimeZoneSseClients, churchId, res);
};

export const removeChurchServiceTimeZoneSseClient = (churchId, res) => {
  removeClient(churchServiceTimeZoneSseClients, churchId, res);
};

export const emitChurchServiceTimeZoneInvalidation = (
  churchId,
  serviceTimeZoneRevision,
) => {
  const clients = churchServiceTimeZoneSseClients.get(churchId);
  if (!clients?.size || typeof serviceTimeZoneRevision !== "string") return;

  const event = JSON.stringify({
    type: "service-time-zone-revision",
    churchId,
    serviceTimeZoneRevision,
  });

  clients.forEach((client) => {
    try {
      client.write(`data: ${event}\n\n`);
    } catch (error) {
      console.error("Could not write church service timezone SSE event:", error);
    }
  });
};

export const emitTeamsEvent = (churchId, type, payload = {}) => {
  const clients = teamsSseClients.get(churchId);
  if (!clients?.size) return;

  // The Teams stream is authorized independently from Services. Keep the
  // Services events as invalidation hints so a Teams-only subscriber can
  // never receive a plan or template document through this channel.
  let safePayload = payload;
  if (type === "service-plan-updated") {
    safePayload = {
      ...(typeof payload.planKey === "string" ? { planKey: payload.planKey } : {}),
      ...(typeof payload.saveOperationId === "string"
        ? { saveOperationId: payload.saveOperationId }
        : {}),
    };
  } else if (type === "service-plan-template-updated") {
    safePayload = typeof payload.templateId === "string"
      ? { templateId: payload.templateId }
      : {};
  }

  const event = JSON.stringify({
    type,
    churchId,
    timestamp: Date.now(),
    ...safePayload,
  });

  clients.forEach((client) => {
    try {
      client.write(`data: ${event}\n\n`);
    } catch (error) {
      // A dead connection will be cleaned up by its own "close" handler; don't
      // let one broken pipe stop the broadcast to everyone else.
      console.error("Could not write teams SSE event:", error);
    }
  });
};
