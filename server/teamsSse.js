// Server-Sent Events fan-out for the Teams page. Teams data lives in the
// SQL/REST backend (not CouchDB), so there is no live replication channel like
// the Controller has. This module lets the schedule mutation handlers push a
// "this changed, here's the new doc" notification to every other client viewing
// the same church, giving the scheduling grid real-time collaboration without
// touching the trusted REST write path.
//
// The client registry is in-memory, which is sufficient for the current
// single-instance deployment. If the server is ever load-balanced across
// multiple instances, events emitted on one instance won't reach SSE clients
// connected to another — that would need a shared pub/sub (e.g. Redis).

const teamsSseClients = new Map();

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
  const clients = teamsSseClients.get(churchId);
  if (!clients) return;
  clients.delete(res);
  if (clients.size === 0) {
    teamsSseClients.delete(churchId);
  }
};

export const emitTeamsEvent = (churchId, type, payload = {}) => {
  const clients = teamsSseClients.get(churchId);
  if (!clients?.size) return;

  const event = JSON.stringify({
    type,
    churchId,
    timestamp: Date.now(),
    ...payload,
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
